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
import { chipModel } from "@/components/trip/DayChips";
import { fetchTripDetail } from "@/lib/apiClient";
import { formatTripDate } from "@/lib/formatDate";
import { initialsFor } from "@/lib/initials";
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

// Sparkline (Task 5) needs a per-day stop count and city, but TripSummary
// (what the trips list fetches) carries no day/stop/city data at all (only
// tripId/name/status/members/createdAt) — that lives on TripDetail. Rather
// than fabricate numbers, this fetches the real TripDetail on mount and
// derives the sparkline from its `days` array via DayChips.tsx's
// `chipModel` (the same real per-day city derivation DayChips/Board/
// CalendarLens already use, so this trip's colors agree everywhere rather
// than reinventing a second, divergent city lookup). `null` means "no real
// data to show yet" (still loading, or the fetch failed) — the render below
// never falls back to invented bars for that state.
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

  useEffect(() => {
    let cancelled = false;
    setSparkline({ status: "loading" });
    setStartDate(null);
    void fetchTripDetail(trip.tripId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSparkline({
          status: "ready",
          days: chipModel(result.value).map((d) => ({ stops: d.stops, city: d.city })),
        });
        setStartDate(result.value.startDate);
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
            <StatTile tone="brand" value={String(trip.members.length)} label="travelers" />
            {/* "days planning" (createdAt -> now) and "decisions" (below)
                stand in for the mock's "stops planned"/"not booked"/"need a
                decision" tiles, which need stop and booking data TripSummary
                doesn't carry. See the Task 6 report for the full rationale. */}
            <StatTile tone="warning" value={daysPlanning === null ? "—" : String(daysPlanning)} label="days planning" />
            <StatTile tone="danger" value="—" label="decisions · not tracked yet" />
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            <Link href={`/trips/${trip.tripId}`} className={cn(buttonVariants({ variant: "primary", size: "md" }))}>
              Open plan
            </Link>
            {shareSlot}
          </div>
        </div>

        <div className="bg-moss p-6">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate">Shape of the trip</div>
          </div>
          <div className="mt-4">
            {sparkline.status === "ready" && sparkline.days.some((d) => d.stops > 0) ? (
              <Sparkline days={sparkline.days} />
            ) : (
              // Honest placeholder for every case with no bars to draw:
              // not loaded yet, failed to load, no days yet, or days with
              // zero stops (previously rendered as an unexplained blank
              // moss box — sparklineBars legitimately returns 0 bars per
              // day here, which isn't a bug, but showing nothing at all
              // read as broken rather than empty).
              <div
                role="status"
                aria-label="Shape of the trip"
                className="flex h-24 items-center justify-center rounded-xl bg-moss p-2 text-xs text-slate"
              >
                {sparkline.status === "loading"
                  ? "Loading…"
                  : sparkline.status === "error"
                    ? "Unavailable"
                    : sparkline.days.length === 0
                      ? "No days yet"
                      : "No stops planned yet"}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
