import type { TripDetail } from "@tc/contracts";
import { formatTripDate } from "@/lib/formatDate";
import { chipModel } from "./DayChips";

// Handoff `current/…dc.html:255-296`: a bordered pill — accent dot, date
// range, then (each separated by a divider) day/stop/city counts. The
// handoff also put a crew control here (stacked avatars + label, opening
// Trip settings); it was dropped in the 2026-08-30 design pass — see the
// comment where it used to sit.
export function TripMetaPill({ detail }: { detail: TripDetail }) {
  const days = detail.days;
  const stops = days.reduce((sum, d) => sum + d.activityIds.length, 0);
  const cities = new Set(chipModel(detail).map((d) => d.city).filter((c): c is string => c !== null));

  const start = days[0]?.date ?? detail.startDate;
  const end = days[days.length - 1]?.date ?? null;
  const dateRange =
    start === null
      ? "No dates set"
      : end === null || end === start
        ? formatTripDate(start)
        : `${formatTripDate(start)} – ${formatTripDate(end)}`;

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-hairline bg-surface py-1.5 pl-3 pr-3.5">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand" />
      <span className="font-mono text-xs text-ink">{dateRange}</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{days.length} days</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{stops} stops</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{cities.size} cities</span>

      {/* No member avatars, and no crew control at all: "Can we drop this
          ownership tile all togther? DA?" (Mitchell, 2026-08-30 design pass —
          the "DA?" is him reading a member's initials and not knowing what
          they were for, which is the whole argument). This pill answers "what
          is this trip" — dates, days, stops, cities — and who is on it is a
          different question, answered properly in Trip settings' Travellers
          panel rather than by two grey initials.

          Nothing is stranded by removing it. It used to be one of three ways
          into Trip settings; the other two — the trip title and the header's
          own ghost "Trip settings" button — are untouched. */}
    </div>
  );
}
