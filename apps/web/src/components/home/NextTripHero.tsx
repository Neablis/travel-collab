import type { ReactNode } from "react";
import Link from "next/link";
import type { TripSummary } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { buttonVariants } from "@/components/ui/button";
import { Sparkline, type SparklineDay } from "@/components/trip/Sparkline";
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

// Sparkline (Task 5) needs a per-day stop count, but TripSummary carries no
// day/stop data at all (only tripId/name/status/members/createdAt) — that
// lives on TripDetail, which this presentational hero deliberately doesn't
// fetch (out of scope for a summary-list card). Until a later task wires a
// real day shape in here, this renders a small deterministic placeholder
// (seeded from tripId, not Math.random, so it's stable across renders/SSR)
// so the "shape of the trip" panel has something to show. Simulated, not
// real trip data — see the Task 6 report.
function placeholderDays(tripId: string): SparklineDay[] {
  const seed = tripId.replace(/-/g, "");
  return Array.from({ length: 7 }, (_, i) => {
    const code = seed.charCodeAt(i % seed.length) || 0;
    return { stops: 1 + ((code + i) % 4) };
  });
}

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
                carries none of those (no start date, no day/city data), so
                this shows only the one date-shaped field the DTO actually
                has: when the trip was created. */}
            {createdLabel && (
              <div className="mt-1.5">
                <DataText size="sm">Created {createdLabel}</DataText>
              </div>
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
            <Sparkline days={placeholderDays(trip.tripId)} />
          </div>
        </div>
      </div>
    </Card>
  );
}
