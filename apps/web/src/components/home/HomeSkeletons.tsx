import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * Home's two placeholder regions — M26 link 7, §3b, `dc.html:1462-1520`
 * (`homeHero`) and `:1607-1632` (`homeTrips`).
 *
 * **Why they live in one file and not in `page.tsx`.** Home is already a very
 * long component and these are pure shape: no state, no props from the page,
 * nothing to read. Keeping them out means the page's own diff stays about the
 * three-state branch, which is the part worth reviewing.
 *
 * **Why the proportions are copied rather than invented.** §3b: *"A loading
 * page should read as a trip, not as a blank form: the shapes carry the real
 * proportions."* The spark bars below are the artboard's own 14 heights, which
 * is why they are a literal list and not `Math.random()` — a placeholder that
 * reshuffles on every render is motion that means nothing.
 */

// dc.html:1505 — `skSpark`, the artboard's 14 bar heights, as fractions of the
// 96px well (`h-24`) it stands in. Written as scale classes rather than
// `style={{ height: "34%" }}` or `h-[34%]`: the colour wall bans arbitrary
// Tailwind values, and `Skeleton` deliberately takes no `style` prop — a style
// escape hatch on a placeholder is how a `background` gets in.
const SPARK_HEIGHTS = [
  "h-8",
  "h-14",
  "h-17",
  "h-11",
  "h-21",
  "h-15",
  "h-12.5",
  "h-18",
  "h-9.5",
  "h-16",
  "h-20",
  "h-12",
  "h-15",
  "h-10.5",
];

/** Widths differ per bar so the three cards do not read as one repeated shape. */
const CARD_TITLE_WIDTHS = ["w-3/4", "w-2/3", "w-4/5"];

export function NextTripHeroSkeleton() {
  return (
    <SkeletonRegion
      label="Loading your next trip"
      className="grid grid-cols-1 overflow-hidden rounded-lg border border-hairline bg-surface md:grid-cols-2"
    >
      <div className="flex flex-col gap-4.5 border-hairline p-8 md:border-r">
        <div className="flex items-center gap-2.5">
          <Skeleton circle className="h-5 w-19" />
          <Skeleton circle className="h-3 w-16" />
        </div>
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-6.5 w-3/4" />
          <Skeleton className="h-6.5 w-2/5" />
          <div className="flex items-center gap-2 pt-0.5">
            <Skeleton circle className="h-3 w-29" delay={2} />
            <Skeleton circle className="h-3 w-14" delay={2} />
            <Skeleton circle className="h-3 w-16" delay={2} />
          </div>
        </div>
        {/* *Open trip* and §35.2's one line after it — a button and a line of
            text, so the second bone is a text line, not a second button. */}
        <div className="flex items-center gap-4.5">
          <Skeleton className="h-9 w-26" delay={3} />
          <Skeleton circle className="h-3 w-32" delay={3} />
        </div>
      </div>
      <div className="flex flex-col gap-4 p-7">
        <div className="flex items-center justify-between gap-3">
          <Skeleton circle className="h-3 w-32" />
          <Skeleton circle className="h-3 w-18" />
        </div>
        <div className="flex h-24 items-end gap-1.5">
          {SPARK_HEIGHTS.map((height, i) => (
            <Skeleton key={i} className={`flex-1 ${height}`} delay={2} />
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function TripGridSkeleton() {
  return (
    <SkeletonRegion
      label="Loading your trips"
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {CARD_TITLE_WIDTHS.map((titleWidth, card) => (
        <div key={card} className="flex h-42 flex-col gap-3 rounded-lg border border-hairline p-5">
          <div className="flex items-center justify-between">
            <Skeleton circle className="h-1.5 w-11" />
            <Skeleton className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton className={`h-4.5 ${titleWidth}`} />
            <Skeleton circle className="h-2.5 w-2/5" delay={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Skeleton circle className="h-2.5 w-11/12" delay={2} />
            <Skeleton circle className="h-2.5 w-3/5" delay={2} />
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 border-t border-hairline pt-3">
            <Skeleton circle className="h-6.5 w-6.5" delay={3} />
            <Skeleton circle className="h-6.5 w-6.5" delay={3} />
            <Skeleton circle className="h-2.5 w-13" delay={3} />
            <div className="flex-1" />
            <Skeleton circle className="h-5 w-16" delay={3} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
