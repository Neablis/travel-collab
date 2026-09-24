"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { TripSummary } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { PHONE_TOUCH, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline, type SparklineDay } from "@/components/trip/Sparkline";
import { SparklineSkeleton } from "./HomeSkeletons";
import { cityFor } from "@/lib/dayChips";
import { fetchTripDetail } from "@/lib/apiClient";
import { cachedRead } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { formatTripDate, relativeCalendarDays } from "@/lib/formatDate";
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
};

// Sparkline needs each day's real stop count and real city, but TripSummary
// (what the trips list fetches) carries no day/activity/city data at all
// (only tripId/name/status/members/createdAt) — that lives on TripDetail.
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
 * @returns The rendered trip overview hero
 */
export function NextTripHero({ trip, menuSlot }: NextTripHeroProps) {
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
  const countdown =
    startDate === null || today === null ? null : relativeCalendarDays(startDate, today);
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

  return (
    // `data-testid` for the same reason TripCard carries one: KI-28's e2e waits
    // for THIS trip's cost line before opening its menu, and since §35.2 a
    // trip is either the hero or a card, never both — which one depends on
    // what else the shared e2e account made first.
    <Card raised className="overflow-hidden p-0" data-testid="next-trip-hero">
      <div className="grid hero-grid">
        <div className="flex flex-col gap-5 border-b border-hairline p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2.5">
            <Badge variant="brand">Next trip</Badge>
            {/* **The countdown** (DRIFT D6, `dc.html:1540`, M26 link 9d). D6
                is two things and only one of them is blocked: WHICH trip the
                hero picks needs a start date on `TripSummary` (KI-034, still
                open — `nextTrip` is `visibleTrips[0]`), but this hero already
                fetches the whole `TripDetail` for its sparkline, so the date
                it is counting to is real and has been all along.

                **It stays honest about a trip that has started or passed**,
                which the selection bug makes likely rather than theoretical:
                `relativeCalendarDays` says "yesterday" and "12 days ago" as
                readily as "in 47 days". A countdown that only counts down
                would print nothing, or a negative, for exactly the case D6
                warns the hero can land on.

                Absent until the first client frame and until the trip's real
                start date lands — see `today`'s note for why it is read in an
                effect, and `startDate`'s for why this hero never invents a
                date it has not been given. */}
            {countdown !== null && <DataText size="sm">{countdown}</DataText>}
            {menuSlot !== undefined && <div className="ml-auto">{menuSlot}</div>}
          </div>

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
            {/* Meta row (README: "dates · length · cities") — TripSummary
                itself carries none of those (no start date, no day/city
                data), but TripDetail (fetched above, for the sparkline)
                does have a real start date. Prefer that once it's in; until
                then (or if the fetch fails), fall back to the one
                date-shaped field TripSummary actually has: when the trip
                was created. */}
            {startDate !== null ? (
              <div className="mt-1.5">
                <DataText size="sm">{formatTripDate(startDate)}</DataText>
              </div>
            ) : (
              createdLabel && (
                <div className="mt-1.5">
                  <DataText size="sm">Created {createdLabel}</DataText>
                </div>
              )
            )}
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
            <div className="mt-1.5 min-h-10 leading-5 sm:min-h-5">
              {plannedOfBudget && <DataText size="sm">{plannedOfBudget}</DataText>}
            </div>
          </div>

          <div className="flex flex-wrap items-center" role="group" aria-label={`${trip.members.length} traveler${trip.members.length === 1 ? "" : "s"}`}>
            {trip.members.map((member, i) => (
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
            <Link href={`/trips/${trip.tripId}`} className={cn(buttonVariants({ variant: "primary", size: "md" }))}>
              Open trip
            </Link>
            {/* A link, where the artboard draws a button with the same
                handler as *Open plan*: it goes to the trip, and a navigation is
                a link — middle-clickable, and read as one. The trip's own
                conflict banner is where the decisions are made. */}
            {(detailLoading || hasDecisions || hasUnbooked) && (
              <div className="flex min-h-11 basis-full flex-wrap items-center gap-x-4.5 gap-y-3 md:min-h-0 md:basis-auto">
                {detailLoading ? (
                  <Skeleton circle className="h-3 w-32" delay={3} />
                ) : (
                  <>
                    {hasDecisions && (
                      <Link
                        href={`/trips/${trip.tripId}`}
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
        </div>

        <div className="bg-moss p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate">Shape of the trip</div>
          <div className="mt-4">
            {sparkline.status === "ready" && sparkline.days.length > 0 ? (
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
