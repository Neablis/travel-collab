"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";

/**
 * **The map could not draw, and the stops are still readable.**
 *
 * SPEC §13's phone Map tab owes this, and `MapLens` had **zero** hits for any
 * failure UI at all before M26 link 14 — tiles that never arrived left a paper
 * rectangle with nothing in it and nothing said about it. Project rule 6 asks
 * every screen for a defined empty, offline/sync-fail and conflict state; this
 * is the map's offline one.
 *
 * **Four things, and the order matters.** A title so the blank area is
 * explained rather than merely decorated; the reassurance, because the thing a
 * reader actually fears is that their plan is gone and it is not — only the
 * picture of it is; *Try again*, because a tile failure is usually transient;
 * and *Open Plan*, because the stops are right there in a surface that needs no
 * network. Offering only *Try again* would strand somebody on a train.
 *
 * Presentational on purpose: `MapLens` owns the failure signal and the retry,
 * and link 4's shared-day map will mount this same panel rather than growing a
 * second one that words it differently.
 *
 * **Open Plan is an `href`, not a callback.** The first cut took
 * `onOpenPlan: () => void` and reached for `useRouter` in `MapLens` — which
 * gave a map component a hard dependency on the app router for one overlay
 * button, and broke 43 of its own tests that had never needed one. A
 * navigation should be an anchor regardless: middle-click, open-in-new-tab and
 * every assistive technology that reads links as links all work, and none of
 * them do on a button with a handler.
 */
export function MapOfflineState({
  onRetry,
  openPlanHref,
  retrying = false,
}: {
  onRetry: () => void;
  /** Absent where there is no Plan to open — the shared day, for one. */
  openPlanHref?: string;
  retrying?: boolean;
}) {
  return (
    <div
      role="status"
      data-testid="map-offline"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-moss p-6 text-center"
    >
      <Heading level={3}>The map could not load</Heading>
      {/* The reassurance, and it is the load-bearing sentence: what a reader
          fears when a screen goes blank is that the thing itself is gone. */}
      <Text variant="secondary" className="max-w-80 text-pretty">
        Your stops are safe — this is only the picture of them. Everything is still readable in
        Plan, which needs no connection.
      </Text>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="touch" onClick={onRetry} disabled={retrying} data-testid="map-offline-retry">
          {retrying ? "Trying…" : "Try again"}
        </Button>
        {openPlanHref !== undefined && (
          <Link
            href={openPlanHref}
            className={`${buttonVariants({ variant: "ghost", size: "touch" })} no-underline`}
            data-testid="map-offline-open-plan"
          >
            Open Plan
          </Link>
        )}
      </div>
    </div>
  );
}
