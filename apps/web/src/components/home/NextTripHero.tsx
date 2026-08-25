"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { TripSummary } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { buttonVariants } from "@/components/ui/button";
import { Sparkline, type SparklineDay } from "@/components/trip/Sparkline";
import { cityFor } from "@/components/trip/DayChips";
import { fetchTripDetail } from "@/lib/apiClient";
import { formatTripDate } from "@/lib/formatDate";
import { initialsFor } from "@/lib/initials";
import { tripSpend, plannedOfBudgetLine } from "@/lib/cost";
import { cn } from "@/lib/cn";

export type NextTripHeroProps = {
  trip: TripSummary;
  // Filled by the caller (app/page.tsx, Task 18) with a secondary-variant
  // <ShareButton> (components/trip/ShareButton.tsx) — the hero itself stays
  // behavior-free about sharing (brief, Interfaces).
  shareSlot?: ReactNode;
};

const STAT_TILE_TONE_CLASSES = {
  brand: "bg-brand-tint text-brand-pressed",
  warning: "bg-warning-tint text-warning-ink",
  danger: "bg-danger-tint text-danger-ink",
} as const;

type StatTileTone = keyof typeof STAT_TILE_TONE_CLASSES;

function StatTile({ tone, value, label }: { tone: StatTileTone; value: string; label: string }) {
  return (
    <div data-testid="stat-tile" className={cn("rounded-xl p-3.5", STAT_TILE_TONE_CLASSES[tone])}>
      <DataText className="block text-2xl leading-none">{value}</DataText>
      <div className="mt-1 text-xs">{label}</div>
    </div>
  );
}

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
// brand Badge, trip name heading, meta row, avatar stack, three stat tiles,
// primary Open plan + secondary Share (via shareSlot). Right: --color-moss
// panel with the "shape of the trip" sparkline.
export function NextTripHero({ trip, shareSlot }: NextTripHeroProps) {
  const created = new Date(trip.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const daysPlanning = Number.isNaN(created.getTime())
    ? null
    : Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));

  // Real TripDetail, fetched on mount (and again if the hero starts
  // rendering a different trip) — the source for both the sparkline and the
  // real start date below. See the SparklineFetchState comment above for why
  // "loading"/"error" never render fabricated bars.
  const [sparkline, setSparkline] = useState<SparklineFetchState>({ status: "loading" });
  const [startDate, setStartDate] = useState<string | null>(null);
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
  // The third stat tile's real, live count of the trip's open conflicts —
  // TripDetail.conflicts (packages/contracts/src/detail.ts), the same array
  // ConflictBanner/ConflictList already read elsewhere. `null` follows the
  // exact same "nothing honest to say yet" pattern as startDate/
  // plannedOfBudget above: still loading, or the fetch failed. This used to
  // be a hardcoded `value="2"` behind a Preview (id "home-decisions") shell
  // (Task 6) — now that it's backed by real data, it renders for real, not
  // as a preview.
  const [conflictCount, setConflictCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSparkline({ status: "loading" });
    setStartDate(null);
    setPlannedOfBudget(null);
    setConflictCount(null);
    void fetchTripDetail(trip.tripId).then((result) => {
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
      } else {
        setSparkline({ status: "error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trip.tripId]);

  return (
    <Card raised className="overflow-hidden p-0">
      <div className="grid hero-grid">
        <div className="flex flex-col gap-5 border-b border-hairline p-6 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2.5">
            <Badge variant="brand">Next trip</Badge>
          </div>

          <div>
            <Heading level={2}>{trip.name}</Heading>
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
            {plannedOfBudget && (
              <div className="mt-1.5">
                <DataText size="sm">{plannedOfBudget}</DataText>
              </div>
            )}
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
                {initialsFor(member.userId)}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5 pt-0.5">
            <StatTile
              tone="brand"
              value={String(trip.members.length)}
              label={trip.members.length === 1 ? "traveler" : "travelers"}
            />
            {/* "days planning" (createdAt -> now) stands in for the mock's
                "stops planned"/"not booked" tiles, which need stop/booking
                data TripSummary doesn't carry. See the Task 6 report for the
                full rationale. */}
            <StatTile tone="warning" value={daysPlanning === null ? "—" : String(daysPlanning)} label="days planning" />
            {/* Real, live conflict count off the same TripDetail.conflicts
                fetch above — no longer a hardcoded fabrication behind a
                Preview shell (Task 8.5; see the conflictCount comment
                above). "—" while still loading/failed, matching the "days
                planning" tile's own loading convention. */}
            <StatTile
              tone="danger"
              value={conflictCount === null ? "—" : String(conflictCount)}
              label={conflictCount === 1 ? "open conflict" : "open conflicts"}
            />
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            <Link href={`/trips/${trip.tripId}`} className={cn(buttonVariants({ variant: "primary", size: "md" }))}>
              Open plan
            </Link>
            {shareSlot}
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
            ) : (
              <div
                role="status"
                aria-label="Shape of the trip"
                className="flex h-24 items-center justify-center rounded-xl p-2 text-xs text-slate"
              >
                {sparkline.status === "loading" ? "Loading…" : sparkline.status === "error" ? "Unavailable" : "No days yet"}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
