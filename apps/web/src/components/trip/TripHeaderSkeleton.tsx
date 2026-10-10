import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { isDemoTripId } from "@/lib/demoTrip";
import { cn } from "@/lib/cn";

/**
 * **The trip header's own box while the trip is in flight** (Mitchell, Vercel
 * Toolbar on the trip preview: *"Header doesnt have a skeleton element on page
 * loading"*).
 *
 * `TripBoardScreen` used to render nothing at all until `TripProvider`
 * answered, so the whole board, header included, appeared in one jump. The
 * header is the one part of the page whose shape does not depend on the data
 * — a back link, a title, the actions, the meta row, the view tabs — so it is
 * drawn here at its real height and the board's body fills in under it.
 *
 * **Same containers, same classes, not measured numbers.** Every wrapper below
 * restates `TripHeader`'s own (the sticky shell's padding, the `max-md:`
 * one-row collapse, the 44px nav row, the `md:flex` meta row, the tabs row's
 * `pt-3 pb-3 max-md:py-0`), and every text bone sits in a line box of the
 * text it stands in for (`text-xl` for the title, `text-xs` for the date
 * line), so its height comes from the same rules the loaded header's does.
 * What it cannot know: the badges a role or a draft adds beside the title, and
 * the phone's pinned day rail — both depend on the trip.
 *
 * Kept out of `TripHeader.tsx` on purpose: that component's controls change
 * often, and a placeholder that only renders while there is no trip has no
 * reason to share its hooks.
 */
export function TripHeaderSkeleton({ tripId }: { tripId: string }) {
  const demo = isDemoTripId(tripId);
  return (
    <>
      <div
        className={cn(
          "sticky z-20 border-b border-hairline bg-surface px-6 pt-3.5",
          "max-md:px-3 max-md:pt-1.5 max-md:pb-1.5",
          demo ? "pinned-at-top" : "below-app-header",
        )}
        data-testid="trip-header-skeleton"
      >
        <SkeletonRegion label="Loading the trip">
          <div className="flex flex-wrap items-start justify-between gap-3 max-md:flex-nowrap max-md:items-center max-md:gap-1">
            <div className="flex flex-auto flex-col gap-1 max-md:contents">
              {/* `← Your trips` and the Ask pill; dropped on /demo, as the real row is. */}
              {!demo && (
                <div className="flex w-full items-center justify-between gap-3 max-md:contents">
                  <span className="flex min-h-11 items-center max-md:w-11 max-md:shrink-0 max-md:justify-center">
                    <Skeleton circle className="h-3 w-20 max-md:w-4" />
                  </span>
                  <span className="flex max-md:order-1">
                    <Skeleton circle className="h-11 w-18" delay={2} />
                  </span>
                </div>
              )}
              <div className="flex items-center gap-x-2 max-md:min-w-0 max-md:flex-1">
                <span className="block min-w-0 font-display text-xl max-md:flex-1">
                  <Skeleton className="inline-block h-6 w-56 align-middle max-md:w-3/4" />
                </span>
                <Skeleton circle className="h-5 w-16 max-md:hidden" delay={2} />
              </div>
            </div>
            <div className="flex items-center gap-2 max-md:order-2">
              <Skeleton className="h-9 w-24 max-md:hidden" delay={2} />
              <Skeleton className="h-9 w-22 max-md:hidden" delay={2} />
              {/* The phone's `⋯` menu, at the 44px button floor. */}
              <span className="flex size-11 items-center justify-center md:hidden">
                <Skeleton className="size-8" delay={2} />
              </span>
            </div>
          </div>
          {/* The date pill and the budget chip, stretched to the chip's height. */}
          <div className="mt-2 hidden items-stretch justify-between gap-3 md:flex">
            <Skeleton circle className="h-10 w-48" delay={3} />
            <Skeleton circle className="h-10 w-40" delay={3} />
          </div>
          {/* The view tabs and the Notebooks pill — off a phone, as theirs are. */}
          <div className="flex flex-col gap-3 pt-3 pb-3 max-md:py-0">
            <div className="flex items-center gap-4 max-md:hidden">
              <Skeleton className="h-8 w-72" delay={3} />
              <div className="min-w-3 flex-auto" />
              <Skeleton className="h-8 w-32" delay={3} />
            </div>
          </div>
        </SkeletonRegion>
      </div>
      {/* The phone's line under the pinned row: the status badge and the dates. */}
      <div aria-hidden className="flex flex-wrap items-center gap-x-2 gap-y-1 px-6 pt-2 md:hidden">
        <Skeleton circle className="h-5 w-16" delay={2} />
        <span className="block text-xs">
          <Skeleton circle className="inline-block h-3 w-28 align-middle" delay={3} />
        </span>
      </div>
    </>
  );
}
