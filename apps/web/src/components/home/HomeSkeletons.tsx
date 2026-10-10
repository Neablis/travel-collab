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

/**
 * **The hero's own box model, row for row** (Mitchell, Vercel Toolbar on the
 * Home preview: *"The skeleton for this element is shorter than the actual
 * element … the size here should be pretty consistent"*, with the badge row
 * selected).
 *
 * It was the artboard's proportions — `p-8`, `gap-4.5`, a 20px badge row, two
 * title bars and no travellers — so the hero changed height when it landed.
 * Now each row is the loaded `NextTripHero`'s: `Card`'s `rounded-md` and
 * shadow, `.hero-grid`'s columns, `p-6` at `gap-5`; the badge row at the 32px
 * of the `icon` menu button that ends it (44px on a phone, the button floor);
 * the 24px/1.2 title, at `PHONE_TOUCH`'s 44px below `md`; the meta line; the
 * budget slot at its reserved `min-h-10 sm:min-h-5`; the `md` traveller
 * avatars; and *Open trip* with §35.2's one line after it. The right panel is
 * the moss well with its static label — chrome is real from the first frame —
 * and the same bones `SparklineSkeleton` draws.
 */
export function NextTripHeroSkeleton() {
  return (
    <SkeletonRegion
      label="Loading your next trip"
      className="overflow-hidden rounded-md border border-hairline bg-surface shadow-raised"
    >
      <div className="grid hero-grid">
        <div className="flex flex-col gap-5 border-b border-hairline p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2.5">
            <Skeleton circle className="h-5 w-19" />
            <Skeleton circle className="h-3 w-16" />
            <span className="ml-auto flex size-11 items-center justify-center fine:size-8">
              <Skeleton className="size-8" />
            </span>
          </div>
          <div>
            <div className="flex min-h-11 items-center fine:min-h-0">
              <Skeleton className="h-7 w-3/4" />
            </div>
            <div className="mt-1.5 flex h-4.5 items-center">
              <Skeleton circle className="h-3 w-1/2" delay={2} />
            </div>
            <div className="mt-1.5 flex min-h-10 items-start pt-1 sm:min-h-5">
              <Skeleton circle className="h-3 w-2/5" delay={2} />
            </div>
          </div>
          <div className="flex items-center">
            <Skeleton circle className="size-7.5" delay={2} />
            <Skeleton circle className="-ml-2 size-7.5" delay={2} />
          </div>
          {/* *Open trip* and §35.2's one line after it — a button and a line of
              text, so the second bone is a text line, not a second button. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-4.5 gap-y-3">
            <Skeleton className="h-11 w-26 fine:h-9" delay={3} />
            <div className="flex min-h-11 basis-full items-center fine:min-h-0 md:basis-auto">
              <Skeleton circle className="h-3 w-32" delay={3} />
            </div>
          </div>
        </div>
        <div className="bg-moss p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate">Shape of the trip</div>
          <div className="mt-4">
            <SparklineBones />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * **The hero's *Shape of the trip* panel while its own `TripDetail` is in
 * flight** — KI-2026-09-23-e. The page-level skeleton above has resolved by
 * then; this is the hero's second wave.
 *
 * It is the `Sparkline`'s own stack, row for row, because the space is what
 * matters here: the 96px well (`CHART_HEIGHT_PX`), the day-number row under
 * it, and one row of city pills. The placeholder used to be the well alone, so
 * on a phone — where this panel sits under the left column — the hero grew
 * 60px when the detail landed and pushed *Other trips* down under the thumb.
 *
 * `h-4` and `h-6.5` stand in for a 12px/1.35 text line (16.2px) and a pill
 * around one (26.2px): whole-step scale classes, so 0.4px short in total. The
 * one shift left on purpose is a SECOND pill row, which depends on how many
 * cities the trip has and how long their names are, and `TripSummary`, the
 * one thing Home holds before the detail lands, carries no city data at all.
 */
export function SparklineSkeleton() {
  return (
    <SkeletonRegion label="Loading the shape of the trip">
      <SparklineBones />
    </SkeletonRegion>
  );
}

/** The bones alone, so the page-level hero skeleton draws the same panel
 *  without nesting a second `role="status"` inside its own. */
function SparklineBones() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex h-24 items-end gap-1.5">
          {SPARK_HEIGHTS.map((height, i) => (
            <Skeleton key={i} className={`flex-1 ${height}`} delay={2} />
          ))}
        </div>
        {/* The day numbers: one 12px line, reserved and left empty — a row
            of fourteen bones under fourteen bars reads as a second chart. */}
        <div className="h-4" />
      </div>
      <div className="flex gap-1.5">
        <Skeleton circle className="h-6.5 w-20" delay={3} />
        <Skeleton circle className="h-6.5 w-18" delay={3} />
      </div>
    </div>
  );
}

/**
 * **The *Other trips* grid while the list is in flight — `TripCard`'s own
 * stack, row for row** (Mitchell, PR #269 preview: *"the shape of the non main
 * trips doesnt really look like anything but a bunch of geometric circles that
 * are outside the rectangle container"*).
 *
 * Both halves of that were real. The card was a fixed `h-42` (168px) with
 * `p-5` round five rows at `gap-3`, which adds up to about 200px, so the
 * footer's bones were drawn below the card's own border. And nearly every bone
 * was `circle`, so text lines read as pills. Now it is the loaded card's box
 * (`Card`'s `rounded-md` and `p-3`, no fixed height) with its rows: the 46px
 * accent bar and the menu, the title (at `PHONE_TOUCH`'s 44px floor below
 * `md`, like the link it stands in for), the date line, the money slot at its
 * reserved `min-h-10 md:min-h-5`, and the footer's two overlapping avatars and
 * status badge. Text lines are bars; only the avatars and the badge are round.
 */
export function TripGridSkeleton() {
  return (
    <SkeletonRegion
      label="Loading your trips"
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {CARD_TITLE_WIDTHS.map((titleWidth, card) => (
        <div
          key={card}
          className="flex flex-col gap-3 rounded-md border border-hairline bg-surface p-3"
          data-testid="trip-card-skeleton"
        >
          <div className="flex items-start justify-between gap-2">
            <Skeleton circle className="h-1.5 w-11.5" />
            <Skeleton className="size-6" />
          </div>
          <div>
            <div className="flex min-h-11 items-center fine:min-h-0">
              <Skeleton className={`h-5 ${titleWidth}`} />
            </div>
            <Skeleton className="mt-1 h-3.5 w-2/5" delay={2} />
            <div className="mt-1 flex min-h-10 items-start pt-0.5 md:min-h-5">
              <Skeleton className="h-3.5 w-1/2" delay={2} />
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between pt-1">
            <div className="flex items-center">
              <Skeleton circle className="size-6" delay={3} />
              <Skeleton circle className="-ml-2 size-6" delay={3} />
            </div>
            <Skeleton circle className="h-5 w-16" delay={3} />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
