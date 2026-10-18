import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * **What a trip view draws while its own code is still arriving.**
 *
 * `TripBoardScreen` loads each view's module only when that view is open
 * (`next/dynamic`): Overview brings the notebook editor (tiptap), Plan and
 * Calendar bring drag and drop, Map brings MapLibre's glue. Before that split
 * every trip page shipped all four whichever was showing. These are the
 * placeholders for the moment between, kept in a module of their own so that
 * drawing one never imports the view it stands in for.
 *
 * They follow `ui/skeleton.tsx`'s rules: outlines only, no invented values, one
 * labelled `SkeletonRegion` around `aria-hidden` bones. Each holds roughly the
 * height its view will take, so the page below does not jump when it lands.
 */

/**
 * Overview's letter, a table of days and some cards (`dc.html:1966-2013`,
 * the `ovBody` region). `OverviewLens` draws this same component while its
 * page and globals are in flight, so its code arriving and its data arriving
 * look like one continuous wait rather than two different shapes.
 */
export function OverviewLensSkeleton() {
  // The proportions are the artboard's, and they are not arbitrary: a loading
  // Overview should read as a trip page — a title, a paragraph, a table of
  // days, some cards — rather than as a blank form.
  return (
    <SkeletonRegion className="flex flex-col gap-6" label="Loading the Overview">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton circle className="h-3 w-11/12" />
        <Skeleton circle className="h-3 w-10/12" />
        <Skeleton circle className="h-3 w-1/2" delay={2} />
      </div>
      <div className="overflow-hidden rounded-lg border border-hairline">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-3.5 border-b border-hairline px-3.5 py-3">
            <div className="flex w-34 flex-none flex-col gap-1.5">
              <Skeleton circle className="h-2.5 w-20" delay={2} />
              <Skeleton circle className="h-2 w-14" delay={2} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
              <Skeleton circle className="h-2.5 w-10/12" delay={2} />
              <Skeleton circle className="h-2.5 w-1/2" delay={3} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-5 w-1/3" delay={3} />
        {[0, 1, 2].map((card) => (
          <div key={card} className="flex items-center gap-3.5 rounded-lg border border-hairline px-3.5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton circle className="h-3 w-2/5" delay={3} />
              <Skeleton circle className="h-2 w-2/3" delay={3} />
            </div>
            <Skeleton circle className="h-2.5 w-16" delay={3} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * The whole Overview lens before its code is here: `OverviewLens`'s own frame
 * (the letter column and its label row, restated class for class) around the
 * body skeleton above, so the lens lands on the same lines. The label is real
 * chrome, as it is in the lens; only the row's link waits.
 */
export function OverviewLensFallback() {
  return (
    <div className="pt-8 pb-22 max-md:pt-0 max-md:pb-6">
      <div className="tc-overview-letter">
        <div className="mb-6.5 flex min-h-7 items-center justify-between gap-4 border-b border-hairline pb-4.5">
          <span className="font-mono text-2xs tracking-widest text-slate uppercase">Overview</span>
        </div>
        <OverviewLensSkeleton />
      </div>
    </div>
  );
}

/** Four columns, staggered left to right in the handoff's three bands. */
const PLAN_COLUMN_DELAYS: readonly (1 | 2 | 3)[] = [1, 2, 3, 3];

/**
 * Plan's row of day columns, at `Column`'s 268px (`DAY_COLUMN_WIDTH_PX`) and
 * with the board's own top gap. Clipped rather than scrolled: a placeholder
 * has nothing to scroll to.
 */
export function PlanLensSkeleton() {
  return (
    <SkeletonRegion label="Loading the plan" className="flex gap-3 overflow-hidden pt-2.5 pb-6">
      {PLAN_COLUMN_DELAYS.map((delay, column) => (
        <div key={column} className="flex w-67 flex-none flex-col gap-2.5">
          <Skeleton className="h-5 w-1/2" delay={delay} />
          <Skeleton className="h-24 w-full" delay={delay} />
          <Skeleton className="h-24 w-full" delay={delay} />
          <Skeleton className="h-16 w-full" delay={delay} />
        </div>
      ))}
    </SkeletonRegion>
  );
}

/** Calendar's month heading and a seven-column month of cells. */
export function CalendarLensSkeleton() {
  return (
    <SkeletonRegion label="Loading the calendar" className="mt-2 flex flex-col gap-3 pb-6">
      <Skeleton className="h-5 w-40" />
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: 35 }, (_, cell) => (
          <Skeleton key={cell} className="h-24 rounded-none" delay={cell < 14 ? 1 : cell < 28 ? 2 : 3} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * The map's canvas box at the height `MapLens` gives it before it has
 * measured where it starts (`70vh`, floored at 320px), on the same
 * `.map-lens-canvas` class, so the canvas replaces this box rather than
 * growing out of nothing.
 */
export function MapLensSkeleton() {
  return (
    <SkeletonRegion label="Loading the map">
      <div
        className="map-lens-canvas relative overflow-hidden border-t border-hairline bg-paper"
        // eslint-disable-next-line no-restricted-syntax -- the map container's own pre-measure geometry (MapLens's `minHeight: 320, height: "70vh"`), restated so the canvas lands in the box this holds
        style={{ minHeight: 320, height: "70vh" }}
      />
    </SkeletonRegion>
  );
}

/**
 * The docked assistant rail's column while its code arrives: the same
 * `.assistant-rail` box (356px, sticky, full height) and border, so the board
 * gives up its width once rather than twice. Docked only — a sheet or a
 * floating panel lies over the board and takes nothing from it, so it waits
 * with nothing drawn.
 */
export function AssistantRailSkeleton() {
  return (
    <div className="assistant-rail flex shrink-0 flex-col gap-3 self-start border-l-2 border-border-strong bg-surface p-4">
      <SkeletonRegion label="Loading the assistant" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton circle className="h-3 w-11/12" delay={2} />
        <Skeleton circle className="h-3 w-3/4" delay={2} />
      </SkeletonRegion>
    </div>
  );
}
