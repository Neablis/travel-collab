import Link from "next/link";
import type { ReactNode } from "react";
import type { TripSummary, TripStatus } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { DataText } from "@/components/ui/data-text";
import { dayAccentFor, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

export type TripCardProps = {
  trip: TripSummary;
  // The Duplicate/Delete Popover menu, fully built and owned by the caller
  // (page.tsx keeps every bit of open/duplicate/delete state and their
  // handlers unchanged) — this component only renders whatever slot it's
  // given, so behavior is identical to the pre-restyle row.
  menuSlot?: ReactNode;
};

// Same static-map pattern as Sparkline.tsx's BAR_BG / badge.tsx's variant
// map: Tailwind's JIT scanner can't see a template-interpolated `bg-${x}`.
const ACCENT_BAR_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const STATUS_BADGE_VARIANT: Record<TripStatus, "success" | "neutral"> = {
  active: "success",
  deleted: "neutral",
};

function statusLabel(status: TripStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// README §1 "All trips" grid: each Card gets a 46x6px accent bar. dayAccentFor
// was built to key off a day's city (Task 2), but TripSummary — all this grid
// ever fetches — has no city field (that's TripDetail-only, and fetching
// TripDetail per card would turn one list request into an N+1 fan-out, a
// bigger behavioral change than a restyle warrants). Keyed off tripId instead:
// still a real, stable identity per trip, so the same trip always gets the
// same accent across renders/reloads, just not a per-city one.
export function TripCard({ trip, menuSlot }: TripCardProps) {
  const accent = dayAccentFor(trip.tripId);

  // TripSummary carries no start date, length, or cost (those live on
  // TripDetail) — the one date-shaped field it does have is createdAt, an
  // ISO instant. formatTripDate/-Long (lib/formatDate.ts) parse calendar
  // dates (YYYY-MM-DD) and would mis-parse an instant string, so this
  // mirrors NextTripHero's own createdAt formatting (Task 6) rather than
  // misusing that helper.
  const created = new Date(trip.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div
          data-testid="accent-bar"
          aria-hidden
          className={cn("h-1.5 w-[46px] rounded-full", ACCENT_BAR_BG[accent.solid])}
        />
        {menuSlot}
      </div>

      <div>
        <Link href={`/trips/${trip.tripId}`} className="hover:underline">
          <Heading level={3}>{trip.name}</Heading>
        </Link>
        {createdLabel && (
          <div className="mt-1">
            <DataText size="sm">Created {createdLabel}</DataText>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between pt-1">
        <Badge variant={STATUS_BADGE_VARIANT[trip.status]}>{statusLabel(trip.status)}</Badge>
      </div>
    </Card>
  );
}
