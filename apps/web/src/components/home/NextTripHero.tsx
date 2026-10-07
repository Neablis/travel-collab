"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { travellerIds, type TripSummary } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { PHONE_TOUCH, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline, type SparklineDay } from "@/components/trip/Sparkline";
import { SparklineSkeleton } from "./HomeSkeletons";
import { CoverCredit } from "@/components/cover/CoverCredit";
import { CoverImage } from "@/components/cover/CoverImage";
import {
  addFirstDayHref,
  coverHref,
  firstStepLabel,
  inviteHref,
  isUnplanned,
  offersCover,
  ownerAlone,
  tripDateRange,
  tripMetaLine,
} from "./UnplannedTrip";
import { viewerOwnsTrip } from "@/lib/tripRole";
import { cityFor } from "@/lib/dayChips";
import { fetchTripDetail } from "@/lib/apiClient";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { formatTripDateLong, relativeCalendarDays } from "@/lib/formatDate";
import { displayNameFor } from "@/lib/displayName";
import { initialsFor } from "@/lib/initials";
import { needsBooking } from "@/lib/needsBooking";
import { tripSpend, plannedOfBudgetLine } from "@/lib/cost";
import { cn } from "@/lib/cn";

export type NextTripHeroProps = {
  trip: TripSummary;
  /**
   * **The trip's lifecycle menu — Duplicate, Delete or Leave** (M27 D3). The
   * same `⋯` the trip cards carry, built by the caller for both. §35.2 filters
   * the hero out of *Other trips*, so without it a one-trip account would have
   * no way to delete or leave its only trip from Home — and §35's own rule is
   * "nothing orphaned".
   */
  menuSlot?: ReactNode;
  /**
   * The reader's user id, which decides an unplanned trip's next steps (M37
   * D6), as `TripCard` takes it. `undefined` while the session probe is in
   * flight, and `null` for nobody signed in.
   */
  viewerId?: string | null;
};

// Sparkline needs each day's real stop count and real city, but TripSummary
// (what the trips list fetches) carries no day/activity/city data at all
// (only tripId/name/status/members/createdAt/startDate) — that lives on TripDetail.
// Rather than fabricate numbers, this fetches the real TripDetail on mount
// and derives the graph from its `days`/`activities` directly: the stop
// count straight off the day's own `activityIds`, and the city via
// DayChips.tsx's `cityFor` (the same real per-day city derivation
// DayChips/Board/CalendarLens already use, so this trip's colors agree
// everywhere rather than reinventing a second, divergent lookup). `null`
// means "no real data to show yet" (still loading, or the fetch failed) —
// the render below never falls back to invented columns for that state.
type SparklineFetchState =
  | { status: "loading" }
  | { status: "ready"; days: SparklineDay[] }
  | { status: "error" };

// README §1 "Next-trip hero": Card raised, two columns 1.15fr 1fr. Left:
// brand Badge, trip name heading, meta row, avatar stack, then Open trip and
// §35.2's one actionable line. Right: --color-moss
/**
 * Displays the next trip: what needs doing on it, its budget line, and a trip-shape sparkline.
 *
 * @param trip - Summary data for the trip and its travelers
 * @param menuSlot - The trip's lifecycle menu, the same one a trip card carries
 * @param viewerId - The reader's user id, which decides an unplanned trip's next steps
 * @returns The rendered trip overview hero
 */
export function NextTripHero({ trip, menuSlot, viewerId }: NextTripHeroProps) {
  // Who is going, as TripCard counts and draws them (travellers spec §5).
  const going = new Set(travellerIds(trip.members));
  const travellers = trip.members.filter((m) => going.has(m.userId));
  const created = new Date(trip.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Real TripDetail, fetched on mount (and again if the hero starts
  // rendering a different trip) — the source for both the sparkline and the
  // real start date below. See the SparklineFetchState comment above for why
  // "loading"/"error" never render fabricated bars.
  const [sparkline, setSparkline] = useState<SparklineFetchState>({ status: "loading" });
  const [startDate, setStartDate] = useState<string | null>(null);
  // **Today, read in an effect and not during render.** A value derived from
  // `new Date()` while rendering differs between the server pass and the first
  // client one, which React reports as a hydration error — the same reason
  // Home's own date line is set this way. `null` until the first client frame,
  // which is also why the countdown below simply does not render yet rather
  // than rendering a guess.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    setToday(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  }, []);
  // **The date this hero shows** (KI-034): the summary's own `startDate` from
  // the first frame, and the detail's once it has loaded — the detail is the
  // fresher read of the same field, so it wins, including when it says the
  // date was cleared. Before KI-034 the summary had no date and the meta row
  // said "Created …" until the detail landed.
  const shownStartDate = sparkline.status === "ready" ? startDate : trip.startDate;
  const countdown =
    shownStartDate === null || today === null ? null : relativeCalendarDays(shownStartDate, today);
  // "{planned} planned of {budget}" (Task 4.1, M10 Phase 4) — derived from
  // the same real TripDetail fetch as the sparkline above, via tripSpend +
  // formatMoney (KI-2), keyed off the trip's own currency (never per-Money).
  // `null` means "nothing honest to say yet" (still loading, fetch failed,
  // or not yet computed) — render nothing for that state, same "no
  // fabricated placeholder" stance as the sparkline's own states. Only once
  // the detail has actually loaded does this become either the real spend
  // line or the literal "No budget yet" (a real, known fact about that
  // trip, not a stand-in for "unknown").
  const [plannedOfBudget, setPlannedOfBudget] = useState<string | null>(null);
  // The live count of the trip's open conflicts — TripDetail.conflicts
  // (packages/contracts/src/detail.ts), the same array ConflictBanner/
  // ConflictList already read elsewhere. `null` follows the exact same
  // "nothing honest to say yet" pattern as startDate/plannedOfBudget above:
  // still loading, or the fetch failed.
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  // The "not booked" count, off the same TripDetail fetch, via the one shared
  // `needsBooking` predicate the Calendar's per-day `N to book` flag also uses
  // — so the two never disagree about the same trip. That predicate is
  // narrower than SPEC §12's literal wording and says why. `null` is the same
  // "nothing honest to say yet" as its neighbours above.
  const [notBooked, setNotBooked] = useState<number | null>(null);
  const detailLoading = sparkline.status === "loading";
  const hasDecisions = conflictCount !== null && conflictCount > 0;
  const hasUnbooked = notBooked !== null && notBooked > 0;
  // M37 D6, decided from the summary so it is there on the first frame. The
  // next trip is usually a NEW one, so the hero is where the unplanned state
  // is seen most. Only the owner is offered next steps; a reader the trip was
  // shared with is told nothing is planned, as the card tells them.
  //
  // While the reader is unknown (`viewerId` undefined, the session probe in
  // flight) the hero lays out the owner-alone state, hidden: its paragraph and
  // both buttons, invisible and out of the accessibility tree and tab order.
  // That is the commonest answer for a new trip, so it lands in place instead
  // of growing the hero and pushing the trip grid below it down. A reader or
  // an owner with company gets a shorter hero when the answer lands — the
  // less common case — rather than one that is wrong for a moment.
  const unplanned = isUnplanned(trip);
  const viewerKnown = viewerId !== undefined;
  const owns = viewerKnown ? viewerOwnsTrip(trip.members, viewerId) : true;
  const alone = viewerKnown ? ownerAlone(trip, viewerId) : true;
  const holding = unplanned && !viewerKnown;
  // The range only while the summary's start is the one shown: once the
  // detail has moved the start, the summary's end may belong to the old one.
  // With the year either way, as the card says it — a single day without one
  // read as a different format from the range beside it.
  const range = shownStartDate !== null && shownStartDate === trip.startDate ? tripDateRange(trip) : null;
  const dates =
    shownStartDate !== null
      ? (range ?? formatTripDateLong(shownStartDate))
      : createdLabel !== null && !unplanned
        ? `Created ${createdLabel}`
        : null;
  const meta = tripMetaLine(trip, dates);
  // M37: a cover takes the top of the left column as a band the photo fades
  // out of, with the badge and countdown over it and the title on the fade;
  // the travellers move into a footer beside the credit (the approved
  // canvas). Without one, the hero is exactly what it was.
  const { cover } = trip;
  // Held with the owner's buttons while the reader is unknown: an owner may
  // always set one, so it is part of the owner-alone row.
  const pickCover = unplanned && (holding ? cover === null : offersCover(trip, viewerId));

  useEffect(() => {
    let cancelled = false;
    setSparkline({ status: "loading" });
    setStartDate(null);
    setPlannedOfBudget(null);
    setConflictCount(null);
    setNotBooked(null);
    // The same key `TripProvider` reads under, which is the point: the stats
    // below and the board you reach by clicking them are the same document,
    // and this page used to fetch it seconds before the trip route fetched it
    // again. Whichever mounts first pays; the other is free.
    void cachedRead(tripKeys.detail(trip.tripId), () => fetchTripDetail(trip.tripId)).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        const detail = result.value;
        const { days, activities } = detail;
        setSparkline({
          status: "ready",
          days: days.map((day) => ({
            city: cityFor(day, activities),
            stopCount: day.activityIds.length,
          })),
        });
        setStartDate(detail.startDate);
        setPlannedOfBudget(plannedOfBudgetLine(tripSpend(detail), detail.currency));
        setConflictCount(detail.conflicts.length);
        setNotBooked(Object.values(activities).filter((a) => needsBooking(a)).length);
      } else {
        setSparkline({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trip.tripId]);

  // The badge, the countdown and the menu: the column's first row, or laid
  // over the cover's band when there is one.
  const badgeRow = (
    <div className={cn("flex items-center gap-2.5", cover !== null && "absolute top-3 right-3 left-6 sm:top-3.5")}>
      <Badge variant="brand">Next trip</Badge>
      {/* **The countdown** (DRIFT D6, `dc.html:1540`, M26 link 9d). Home
          picks this hero by start date (`orderHomeTrips`, KI-034), and
          this counts to that date.

          **It stays honest about a trip that has started or passed**:
          `relativeCalendarDays` says "yesterday" and "12 days ago" as
          readily as "in 47 days". The hero lands on a past trip when
          every trip is past, or when the trip is under way (the summary
          has no end date, so "under way" ranks as past).

          Absent until the first client frame and for an undated trip —
          see `today`'s note for why it is read in an effect, and
          `shownStartDate`'s for where the date comes from. This hero
          never invents a date it has not been given. */}
      {countdown !== null && (
        <DataText size="sm" className={cn(cover !== null && "cover-over-text text-surface")}>
          {countdown}
        </DataText>
      )}
      {menuSlot !== undefined && (
        <div className={cn("ml-auto", cover !== null && "rounded-lg bg-surface/85")}>{menuSlot}</div>
      )}
    </div>
  );

  const travellerStack = (
    <div className="flex flex-wrap items-center" role="group" aria-label={`${travellers.length} traveler${travellers.length === 1 ? "" : "s"}`}>
      {travellers.map((member, i) => (
        <div
          key={member.userId}
          aria-hidden
          className={cn(
            "grid place-items-center rounded-full border-2 border-surface bg-brand-tint font-semibold text-brand-pressed",
            i > 0 && "-ml-2",
          )}
          // eslint-disable-next-line no-restricted-syntax -- 30px avatar circle + 11px initials text have no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
          style={{ height: "30px", width: "30px", fontSize: "11px" }}
        >
          {initialsFor(displayNameFor(member))}
        </div>
      ))}
    </div>
  );

  return (
    // `data-testid` for the same reason TripCard carries one: KI-28's e2e waits
    // for THIS trip's cost line before opening its menu, and since §35.2 a
    // trip is either the hero or a card, never both — which one depends on
    // what else the shared e2e account made first.
    <Card raised className="overflow-hidden p-0" data-testid="next-trip-hero">
      <div className="grid hero-grid">
        <div className="flex flex-col border-b border-hairline lg:border-b-0 lg:border-r">
          {/* 200px on a phone, 236px from `sm`: the canvas's two bands. Eager:
              the hero is the top of Home, so its photo is never below the fold. */}
          {cover !== null && (
            <CoverImage
              photo={cover}
              veil="band"
              eager
              className="h-50 shrink-0 sm:h-59"
              sizes="(min-width: 1024px) 640px, 100vw"
            >
              {badgeRow}
            </CoverImage>
          )}
          <div className={cn("flex flex-col gap-5 p-6", cover !== null && "relative -mt-7.5 pt-0 sm:-mt-8.5")}>
            {cover === null && badgeRow}

            <div>
              {/* **The name is the way in, as it is on a card.** Since §35.2 the
                  hero is filtered out of *Other trips*, so this is the only place
                  on Home the trip's name appears — and a card's name is a link
                  (TripCard.tsx). Leaving it plain text here would make the one
                  trip you are most likely to open the one whose name you cannot
                  click. Same shape as the card's: the link wraps the heading. */}
              <Link
                href={`/trips/${trip.tripId}`}
                className={cn("inline-flex items-center hover:underline", PHONE_TOUCH)}
              >
                <Heading level={2}>{trip.name}</Heading>
              </Link>
              {/* Meta row (README: "dates · length · cities") — the trip's real
                  start date (`shownStartDate`: the summary's until the detail
                  lands, KI-034). An undated trip falls back to the one other
                  date-shaped fact it has, labelled as what it is: when the trip
                  was created — unless nothing is planned, where it says "No dates
                  yet" (`tripMetaLine`, M37). Length and stops follow. */}
              <div className="mt-1.5">
                <DataText size="sm">{meta}</DataText>
              </div>
              {/* KI-28: reserved slot, same reason as TripCard's own cost line
                  — this hero sits ABOVE the trip grid, so the 27px it used to
                  gain when its TripDetail landed pushed every card (and any
                  actions menu anchored to one) down by that much. Height is
                  reserved whether or not the line arrives; absence still renders
                  nothing rather than a fabricated figure.

                  KI-56: two lines below `sm`, one at `sm` and up — the same
                  reservation TripCard's own slot takes, for the same reason and
                  off the same measurement (see the table in TripCard.tsx, which
                  is the primary record of it). This hero is the surface where
                  the defect was easiest to see: at a 320px viewport its slot is
                  222px wide, and the REAL seeded line "$9,085.00 planned of
                  $16,400.00" already wrapped to two lines there — a plain USD
                  figure, not a contrived one — so the hero grew 20px when its
                  TripDetail landed and pushed the whole trip grid, and any
                  actions menu anchored into it, down by that much. That is
                  precisely the drift KI-28 reserved this slot to stop.

                  `sm` here, `md` in TripCard — not an oversight. This hero's
                  slot widens monotonically below `lg` (222px at a 341px
                  viewport, 402px at 500px, 542px at 640px), so one line is
                  safe from `sm` up. A trip CARD's slot does not: its grid adds
                  a column at `sm`, so each card narrows to a 263px slot at
                  640px, under the 277px the widest figure needs. The table in
                  TripCard.tsx has the numbers. */}
              {/* M37 D6: an unplanned trip has nothing to cost, so the slot
                  carries what to do instead. Static text from the summary, so it
                  never grows when the detail lands. */}
              {unplanned ? (
                <p
                  className={cn("mt-1.5 text-sm text-slate", holding && "invisible")}
                  aria-hidden={holding || undefined}
                >
                  {owns
                    ? `A blank trip. Start with the first ${trip.dayCount === 0 ? "day" : "stop"}${
                        alone
                          ? ", or bring in the people you're going with so they can plan alongside you."
                          : "."
                      }`
                    : "Nothing planned yet."}
                </p>
              ) : (
                <div className="mt-1.5 min-h-10 leading-5 sm:min-h-5">
                  {plannedOfBudget && <DataText size="sm">{plannedOfBudget}</DataText>}
                </div>
              )}
            </div>

            {cover === null && travellerStack}

            {/* **One actionable line, not three stat tiles** (SPEC §35.2). The
                stop count was data, not a task, and Share lives in the trip
                header — so what is left is what someone should DO: decide the
                conflicts, book what is unbooked.

                Each half renders only when its count is known AND above zero.
                While the detail is loading, or after it failed, there is nothing
                honest to say — the tiles said "—" there, and a line reading
                "— need a decision" would be worse. And "0 need a decision" is not
                a task.

                **Its own line below `md`, held open while the detail loads**
                (KI-2026-09-23-e). It used to share the button's row and wrap
                wherever its text ran out — on a 390px phone, "N not booked yet"
                dropped under the button 30px after the page had painted. Now,
                below `md`, it takes a full-width line of its own at the 44px
                phone floor the decisions link already has, and while the detail
                loads that line is a bone rather than nothing. A trip that turns
                out to have nothing to do gives the line back; a trip with
                something to do — the case where the line is worth reading —
                lands in space already made for it. From `md` up it sits beside
                the button as before, where the row never wrapped. */}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-4.5 gap-y-3">
              {/* **`Open trip`, and it was `Open plan`** — Mitchell, Vercel
                  Toolbar comment on the PR #196 preview, 2026-09-20, with this
                  link selected: *"'Open trip' not open plan"*. The href goes to
                  the trip, not to its Plan lens, so the old label named a
                  destination the link does not have: it lands on whichever lens
                  the trip was last left on. `Open trip` is what it actually
                  does. §35.2 redraws it as *Open plan*; M27 D2 keeps this. */}
              {unplanned && owns ? (
                // M37 D6: an unplanned trip's owner gets its first step as the
                // primary action; the name above is still the way into the trip.
                <div
                  className={cn("contents", holding && "invisible")}
                  aria-hidden={holding || undefined}
                  inert={holding || undefined}
                >
                  <Link
                    href={addFirstDayHref(trip.tripId)}
                    className={cn(buttonVariants({ variant: "primary", size: "md" }))}
                  >
                    {firstStepLabel(trip)}
                  </Link>
                  {alone && (
                    <Link
                      href={inviteHref(trip.tripId)}
                      className={cn(buttonVariants({ variant: "secondary", size: "md" }))}
                    >
                      Invite who&apos;s coming
                    </Link>
                  )}
                </div>
              ) : (
                <Link href={`/trips/${trip.tripId}`} className={cn(buttonVariants({ variant: "primary", size: "md" }))}>
                  Open trip
                </Link>
              )}
              {/* M37: the quiet third step, for whoever may set a cover. */}
              {pickCover && (
                <Link
                  href={coverHref(trip.tripId)}
                  className={cn(
                    "inline-flex items-center px-1 text-sm text-slate hover:underline",
                    PHONE_TOUCH,
                    holding && "invisible",
                  )}
                  aria-hidden={holding || undefined}
                  inert={holding || undefined}
                >
                  Choose a cover photo
                </Link>
              )}
              {/* A link, where the artboard draws a button with the same
                  handler as *Open plan*: a navigation is a link — middle-clickable,
                  and read as one.

                  **It opens the Plan view, not the trip's default Overview** —
                  Mitchell, PR #269 preview: *"Clicking this should go to the
                  plans page, not overview. You cant make the decisions on
                  overview page"*. The conflicts this line counts are listed,
                  dismissed and jumped to by `ConflictBanner`, which only `Board`
                  renders, and `Board` is the Plan view (`TripBoardScreen`);
                  Overview is read-only and shows none of them (SPEC §24). A bare
                  `/trips/<id>` lands on Overview, so it took you to a page where
                  the decision could not be made. `?view=Plan` is the URL
                  `PhoneTabBar`'s Plan tab and `MapLens` already use. Not
                  `/plans`: that route is the billing plans page (SPEC §29). */}
              {(detailLoading || hasDecisions || hasUnbooked) && (
                <div className="flex min-h-11 basis-full flex-wrap items-center gap-x-4.5 gap-y-3 md:min-h-0 md:basis-auto">
                  {detailLoading ? (
                    <Skeleton circle className="h-3 w-32" delay={3} />
                  ) : (
                    <>
                      {hasDecisions && (
                        <Link
                          href={`/trips/${trip.tripId}?view=Plan`}
                          className={cn(
                            "inline-flex items-center gap-2 py-1.5 text-sm font-semibold text-danger-ink no-underline hover:underline",
                            PHONE_TOUCH,
                          )}
                        >
                          <span aria-hidden className="size-1.75 shrink-0 rounded-full bg-danger" />
                          {conflictCount} {conflictCount === 1 ? "needs" : "need"} a decision
                        </Link>
                      )}
                      {hasUnbooked && <span className="text-sm text-slate">{notBooked} not booked yet</span>}
                    </>
                  )}
                </div>
              )}
            </div>
            {cover !== null && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-3">
                {travellerStack}
                <CoverCredit photo={cover} />
              </div>
            )}
          </div>
        </div>

        <div className="bg-moss p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate">Shape of the trip</div>
          <div className="mt-4">
            {unplanned ? (
              <EmptyShape startDate={shownStartDate} dayCount={trip.dayCount} />
            ) : sparkline.status === "ready" && sparkline.days.length > 0 ? (
              // Sparkline itself handles a day with zero stops gracefully
              // (an empty, day-numbered slot) — the placeholder below is
              // only for states where there's no real day data at all yet.
              <Sparkline days={sparkline.days} />
            ) : sparkline.status === "loading" ? (
              // KI-2026-09-23-e: the Sparkline's own height, not a 96px box —
              // see SparklineSkeleton for what it reserves and what it cannot.
              <SparklineSkeleton />
            ) : (
              <div
                role="status"
                aria-label="Shape of the trip"
                className="flex h-24 items-center justify-center rounded-xl p-2 text-xs text-slate"
              >
                {sparkline.status === "error" ? "Unavailable" : "No days yet"}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Rows past this are summarised, so a month-long blank trip does not stretch
// the hero a screen tall.
const EMPTY_SHAPE_ROWS = 7;

/**
 * The right panel for an unplanned trip (M37 D6): a dashed, empty bar per
 * dated day, from the start date the hero shows (`shownStartDate`, so the rows
 * and the meta row never disagree) and the summary's day count — days run on
 * from the start, as `tripDetailFromState` dates them — then what fills them
 * in. An undated trip gets the line alone.
 */
function EmptyShape({ startDate, dayCount }: { startDate: string | null; dayCount: number }) {
  const dates: string[] = [];
  if (startDate !== null) {
    const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
    for (let i = 0; i < Math.min(dayCount, EMPTY_SHAPE_ROWS); i++) {
      const day = new Date(y, m - 1, d + i);
      dates.push(day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
    }
  }
  const more = startDate !== null ? dayCount - dates.length : 0;
  return (
    <div className="flex flex-col gap-2">
      {dates.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Days with nothing planned">
          {dates.map((date) => (
            <li key={date} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-slate">{date}</span>
              <span aria-hidden className="h-2.5 flex-1 rounded-full border border-dashed border-border-strong" />
            </li>
          ))}
          {more > 0 && <li className="text-xs text-slate">and {more} more</li>}
        </ul>
      )}
      <p className="text-xs text-slate">Each day fills in as you add stops.</p>
    </div>
  );
}
