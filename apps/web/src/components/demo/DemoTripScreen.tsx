"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { PageContainer } from "@/components/ui/page-container";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { LensRouter } from "@/components/trip/context/LensRouter";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { duplicateTrip } from "@/lib/apiClient";
import { DEMO_PATH, DEMO_TRIP_ID } from "@/lib/demoTrip";
import { rememberDemoClone, takeDemoClone } from "@/lib/pendingDemoClone";
import { cn } from "@/lib/cn";

// `/demo` — the real board, read-only, for someone who has no account yet
// (ADR-031).
//
// The provider stack below is the SAME stack `(app)/trips/[tripId]/page.tsx`
// mounts, in the same order, around the same `TripBoardScreen`. That is the
// whole design: a visitor gets the actual product — Day columns, Timeline,
// Calendar, the Map with its rail and focus card, the day chips, the budget
// chip, the History popover, the unscheduled rack — rather than a simplified
// page built to look like it. Nothing here reimplements a lens, and nothing
// here can drift from one, because there is only one of each.
//
// Read-only is not enforced in this file, deliberately. The demo trip is
// granted to every visitor as a `viewer` at the server's access seam, and
// `TripProvider` already refuses a viewer's writes before they reach the
// optimistic queue. So the board arrives read-only for the same reason an
// invited viewer's board does, and a control added to the board later inherits
// that without anyone remembering this page exists.

export function DemoTripScreen() {
  return (
    <>
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
      <DemoBanner />
      <PageContainer as="main" width="full" className="px-0">
        {/* `LensRouter` reads `useSearchParams()` — which lens you are looking
            at is URL state, so a link to `/demo?lens=Map` opens the map. That
            makes this subtree opt out of static prerendering, and Next.js
            requires the opt-out to be a Suspense boundary rather than a build
            error. `(app)/trips/[tripId]` never needed one because that route is
            dynamic already (it is behind auth); this page is prerendered, which
            is exactly what we want for the front door's most-hit link — the
            shell and the banner ship as static HTML and only the board waits
            for the client.

            The boundary is here rather than around the whole screen so the
            header and the banner — including "Make this trip mine" — are in
            the first paint. */}
        <Suspense fallback={<BoardFallback />}>
          <TripProvider tripId={DEMO_TRIP_ID}>
            <FocusProvider>
              <EditorHost>
                <LensRouter>
                  <TripBoardScreen tripId={DEMO_TRIP_ID} />
                </LensRouter>
              </EditorHost>
            </FocusProvider>
          </TripProvider>
        </Suspense>
      </PageContainer>
    </>
  );
}

/** What the static shell shows while the board's own client subtree arrives. */
function BoardFallback() {
  return (
    <div className="px-7 py-8">
      <Text variant="secondary">Opening the example trip…</Text>
    </div>
  );
}

/**
 * The one thing on this page that is not the ordinary board: what this is, and
 * the way out of it.
 *
 * Above the board rather than inside it, so `TripBoardScreen` does not grow a
 * demo-shaped branch — the board's only concession to the demo is dropping the
 * assistant rail, which has no read-only half to fall back to.
 */
function DemoBanner() {
  const router = useRouter();
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * `pressed` tells a click apart from the automatic run below, and the two
   * differ only in what a 401 means.
   *
   * A click by somebody signed out is a request to sign in: bank the intent and
   * send them. The automatic run cannot know why it is signed out — it fires
   * whenever a live marker is found, which includes somebody who pressed the
   * button, thought better of it and hit Back — so it puts the marker back and
   * says nothing, leaving the button exactly as it found it. Bouncing them to
   * sign in a second time would be the start of a loop; an error message would
   * be shouting about something they did not just ask for.
   */
  const makeItMine = useCallback(
    async ({ pressed }: { pressed: boolean }) => {
      setCopying(true);
      setError(null);
      // The ordinary duplicate endpoint. Signed out it answers 401, which is the
      // visitor's cue to sign in — and to come back and have the copy happen,
      // rather than land here again with the button still to press.
      const result = await duplicateTrip(DEMO_TRIP_ID);
      if (result.ok) {
        router.push(`/trips/${result.value.tripId}`);
        return;
      }
      if (result.error.status === 401) {
        // The marker is the ONLY carrier of this intent (see
        // `lib/pendingDemoClone.ts`). It used to travel alongside a
        // `?clone=1` on the callbackUrl, and that param is gone: a URL is
        // forgeable and shareable, so a link could make a signed-in stranger
        // take a copy they never asked for. Low harm — `duplicateTrip` goes
        // through the ordinary access seam, so it could only ever have cloned
        // the public demo — but it was a whole class of thing that did not
        // need to exist, and it was redundant with the marker anyway
        // (Mitchell, 2026-09-01). `localStorage` is same-origin, so nobody
        // else's page can set it.
        rememberDemoClone();
        setCopying(false);
        if (pressed) {
          router.push(`/signin?callbackUrl=${encodeURIComponent(DEMO_PATH)}`);
        }
        return;
      }
      // Released only on the paths that STAY on this page: `router.push` does not
      // unmount synchronously, so clearing it before navigating re-enables the
      // button while this page is still on screen, and a second click there is a
      // second trip in their list rather than a no-op (CodeRabbit, PR #71).
      setCopying(false);
      setError(result.error.message);
    },
    [router],
  );

  // Coming back from sign-in, having already asked for a copy.
  //
  // Without this, the 401 round trip cost the visitor their click: they pressed
  // "Make this trip mine", signed in, landed back on the demo, and had to press
  // it again — with nothing on the page saying so (Mitchell, 2026-08-28).
  //
  // The marker decides, not the URL. This used to require `?clone=1` on the
  // way back, which meant the page could only finish a copy for somebody the
  // callbackUrl had survived for — and made the intent something a shared link
  // could assert. `takeDemoClone` is read-and-clear, so this and the trip list
  // (`(app)/page.tsx`, where anyone who SIGNED UP actually lands) race for one
  // marker and exactly one of them wins.
  //
  // No `useSearchParams()` here even now that there is no param to read: this
  // page is prerendered, and that hook would pull the banner — the CTA included
  // — behind the board's Suspense boundary and out of the first paint, which is
  // the one thing the boundary was placed to avoid.
  const autoCloned = useRef(false);
  useEffect(() => {
    if (autoCloned.current) return;
    // Once per mount, before the await: StrictMode runs effects twice in dev,
    // and a second pass here is a second trip in somebody's list. The
    // read-and-clear makes that true on its own; this is the cheaper guard.
    autoCloned.current = true;
    if (!takeDemoClone()) return;
    void makeItMine({ pressed: false });
  }, [makeItMine]);

  return (
    <div className="border-y border-hairline bg-moss px-7 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Text as="span" className="font-display text-base font-semibold text-ink">
            This is an example trip — look around.
          </Text>
          <Text as="span" variant="secondary">
            Every view is the real thing, with the changes turned off. Take a copy and it all becomes
            yours to move around.
          </Text>
        </div>
        <div className="flex items-center gap-3">
          {error !== null && (
            <Text as="span" className="text-xs text-danger-ink">
              {error}
            </Text>
          )}
          <Button variant="primary" disabled={copying} onClick={() => void makeItMine({ pressed: true })}>
            {copying ? "Making it yours…" : "Make this trip mine"}
          </Button>
        </div>
      </div>
    </div>
  );
}
