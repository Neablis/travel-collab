"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
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

/** Where the stage starts clearing, and over how much of the scroll. §28's "the map clears out". */
const TAIL_START = 0.72;
const TAIL_LENGTH = 0.18;
/** How far the map drifts up across the whole pin, in px. */
const MAP_DRIFT = 74;
/** The fraction of a chunk's own window spent fading in, and out. */
const EDGE = 0.16;
const ENTER_FROM = 30;
const LEAVE_TO = -26;

const CLAIMS = [
  { label: "One plan", body: "One shared plan your whole group can move around — days, times, costs, who's in." },
  { label: "Together", body: "Everyone moves the same day. Priya moved this an hour later — everyone sees it." },
  { label: "Notebook", body: "Write about it. The numbers keep themselves right." },
  { label: "Playbooks", body: "Borrow a day someone already got right." },
] as const;

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
        if (t < 0 && !first) {
          opacity = 0;
          dy = ENTER_FROM;
        } else if (t > 1 && !last) {
          opacity = 0;
          dy = LEAVE_TO;
        } else {
          const inF = first ? 1 : Math.min(1, Math.max(0, t / EDGE));
          const outF = last ? 1 : Math.min(1, Math.max(0, (1 - t) / EDGE));
          opacity = Math.min(inF, outF);
          dy = (1 - inF) * ENTER_FROM - (1 - outF) * -LEAVE_TO;
        }
        chunk.style.opacity = (opacity * tail).toFixed(3);
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
                className="absolute inset-0 flex flex-col justify-center px-6"
                // Note 2: the rest state is AUTHORED, not applied by the
                // effect. Without it a cold load — or a browser that fires no
                // scroll event because the page opens at the top — stacks all
                // four claims on top of each other.
                // eslint-disable-next-line no-restricted-syntax -- the authored rest state of a scroll-driven sequence; it is overwritten per scroll event and has no token equivalent.
                style={{ opacity: i === 0 ? 1 : 0, willChange: "transform, opacity" }}
              >
                <Text variant="muted" className="uppercase tracking-widest">
                  {claim.label}
                </Text>
                <Text className="mt-2 text-lg text-ink">{claim.body}</Text>
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
