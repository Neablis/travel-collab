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
import { fetchTripDetail } from "@/lib/apiClient";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";

export type NextTripHeroProps = {
  trip: TripSummary;
  // Filled by the caller with the Preview-wrapped Share button (Task 18) —
  // the hero itself stays behavior-free about sharing (brief, Interfaces).
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

// Two initials from a member's userId, e.g. "dev-alice" -> "DA". TripMember
// (packages/contracts/src/trip.ts) only carries a userId, no display name —
// this is a cosmetic stand-in for a real avatar/initial, not sourced from any
// name field that doesn't exist on the DTO.
function initialsFor(userId: string): string {
  const parts = userId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const chars = parts.length >= 2 ? [parts[0]![0], parts[1]![0]] : [...userId.replace(/[^a-zA-Z0-9]/g, "")].slice(0, 2);
  return chars.join("").toUpperCase() || "?";
}

// Sparkline (Task 5) needs a per-day stop count, but TripSummary (what the
// trips list fetches) carries no day/stop data at all (only
// tripId/name/status/members/createdAt) — that lives on TripDetail. Rather
// than fabricate numbers, this fetches the real TripDetail on mount and
// derives the sparkline from its `days` array. `null` means "no real data
// to show yet" (still loading, or the fetch failed) — the render below
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
        setSparkline({ status: "ready", days: result.value.days.map((d) => ({ stops: d.activityIds.length })) });
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
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr]">
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
                  "grid size-[30px] place-items-center rounded-full border-2 border-surface bg-brand-tint text-[11px] font-semibold text-brand-pressed",
                  i > 0 && "-ml-2",
                )}
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
            {sparkline.status === "ready" ? (
              <Sparkline days={sparkline.days} />
            ) : (
              // Honest placeholder for "not loaded yet" / "failed to load" —
              // no fabricated bar data renders in either case.
              <div
                role="status"
                aria-label="Shape of the trip"
                className="flex h-24 items-center justify-center rounded-xl bg-moss p-2 text-xs text-slate"
              >
                {sparkline.status === "loading" ? "Loading…" : "Unavailable"}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
