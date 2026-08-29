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
import { DEMO_CLONE_PARAM, DEMO_PATH, DEMO_TRIP_ID } from "@/lib/demoTrip";
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
   * `signInOn401` is false for the automatic run below, and that asymmetry is
   * the point: a click by someone signed out should take them to sign in,
   * while a 401 on the way BACK from signing in means something is wrong with
   * the session, and bouncing them to sign in again is the start of a loop.
   * There, the honest outcome is the button and a message.
   */
  const makeItMine = useCallback(
    async ({ signInOn401 }: { signInOn401: boolean }) => {
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
      if (result.error.status === 401 && signInOn401) {
        router.push(`/signin?callbackUrl=${encodeURIComponent(`${DEMO_PATH}?${DEMO_CLONE_PARAM}=1`)}`);
        return;
      }
      // Released only on the paths that STAY on this page: `router.push` does not
      // unmount synchronously, so clearing it before navigating re-enables the
      // button while this page is still on screen, and a second click there is a
      // second trip in their list rather than a no-op (CodeRabbit, PR #71).
      setCopying(false);
      setError(
        result.error.status === 401
          ? "Sign in first, then take a copy — this one is not yours to change."
          : result.error.message,
      );
    },
    [router],
  );

  // Coming back from sign-in, having already asked for a copy.
  //
  // Without this, the 401 round trip cost the visitor their click: they pressed
  // "Make this trip mine", signed in, landed back on the demo, and had to press
  // it again — with nothing on the page saying so (Mitchell, 2026-08-28). The
  // sign-in detour carries the intent in its `callbackUrl` and this finishes it.
  //
  // Read from `window.location` in an effect rather than `useSearchParams()`:
  // this page is prerendered, and a `useSearchParams()` call here would pull
  // the banner — the CTA included — behind the board's Suspense boundary and
  // out of the first paint, which is the one thing the boundary was placed to
  // avoid. The auto-clone is a post-hydration action either way.
  const autoCloned = useRef(false);
  useEffect(() => {
    if (autoCloned.current) return;
    if (new URLSearchParams(window.location.search).get(DEMO_CLONE_PARAM) !== "1") return;
    // Once per mount, before the await: StrictMode runs effects twice in dev,
    // and a second pass here is a second trip in somebody's list.
    autoCloned.current = true;
    // Dropped from the URL first, so a reload after a failure is an ordinary
    // `/demo` rather than another attempt. `history.replaceState`, not
    // `router.replace`: this is a URL tidy-up, not a navigation, and a router
    // navigation queued here would race the `router.push` that `makeItMine` is
    // about to make on success.
    window.history.replaceState(null, "", DEMO_PATH);
    void makeItMine({ signInOn401: false });
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
          <Button variant="primary" disabled={copying} onClick={() => void makeItMine({ signInOn401: true })}>
            {copying ? "Making it yours…" : "Make this trip mine"}
          </Button>
        </div>
      </div>
    </div>
  );
}
