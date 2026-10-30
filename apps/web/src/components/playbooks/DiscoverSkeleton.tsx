import { Heading } from "@/components/ui/heading";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { DISCOVER_LINE } from "@/lib/playbooksPreview";

// Discover's shape before it has anything to show: the header both the screen
// and the route's loading boundary draw, and the days' outlines. One file, so
// the first frame of a navigation and the screen it hands over to cannot
// drift apart (`HomeSkeletons.tsx` is the same arrangement for Home).

/** How many card outlines stand in while the first read is in flight. */
const SKELETON_COUNT = 6;

/**
 * Discover's title row and its one line, with `action` (the page's Ask) at the
 * row's end. `min-h-9` is the Ask button's height, so the row does not grow
 * when a plan that has Ask draws it after the first frame.
 */
export function DiscoverIntro({ action }: { action?: React.ReactNode }) {
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <Heading level={1}>Discover</Heading>
        {action}
      </div>
      {/* One line (§35.5), with its second verb back: *"planned and rated"*
          waited for M12 to give anybody a way to rate (M27 D8) — a header
          claiming ratings above cards that carried none would have been the
          first thing a reader disbelieved. 15px has no token; `text-base`
          (14px) is the nearer step that keeps the type scale. */}
      <Text className="mt-1.5 max-w-160 text-slate text-pretty">{DISCOVER_LINE}</Text>
    </div>
  );
}

/** The results' title and a grid of card outlines, at the sizes the results take. */
export function DiscoverDaysSkeleton() {
  return (
    <SkeletonRegion label="Loading days" className="flex flex-col gap-5">
      <Skeleton className="h-6 w-56" />
      <span className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-lg" />
        ))}
      </span>
    </SkeletonRegion>
  );
}

/**
 * Discover before its route has answered: the header, outlines where the
 * search and its filters go, and the days'.
 *
 * The search is an outline, not the real `PlaceSearch`: what is typed into a
 * box here would be lost when the page's own replaces it. `scopeTabs` is
 * whether the reader has the Everyone / Yours / Saved tabs, which only an
 * account does: the frame cannot ask who is reading, but the route it stands
 * in for knows which copy it is (`lib/playbooksReader.ts`).
 */
export function DiscoverLoading({ scopeTabs }: { scopeTabs: boolean }) {
  // Row for row the screen's own column, at its measured heights (phone, then
  // from `md` up): tabs 44/40px, search 52/44px, the phone's Filters button
  // 44px, the desktop filter row 32px, the results line 28px. The search block
  // keeps the phone's `py-1`, which the screen's sticky bar has there.
  return (
    <div className="flex flex-col gap-5">
      <DiscoverIntro />
      <SkeletonRegion label="Loading the search" className="flex flex-col gap-5">
        <span className="flex flex-col gap-5 py-1 md:py-0">
          {scopeTabs && <Skeleton className="h-11 w-64 md:h-10" />}
          <Skeleton className="h-13 w-full md:h-11" />
        </span>
        <Skeleton className="hidden h-8 w-20 md:block" delay={2} />
        <Skeleton className="h-11 w-24 md:hidden" delay={2} />
        <Skeleton className="h-7 w-48" delay={2} />
      </SkeletonRegion>
      <DiscoverDaysSkeleton />
    </div>
  );
}
