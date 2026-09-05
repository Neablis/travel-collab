import type { TripDetail } from "@tc/contracts";
import { formatTripDate } from "@/lib/formatDate";
import { chipModel } from "./DayChips";

/** The three figures this pill states beside the date range. */
export type TripCounts = { days: number; stops: number; cities: number };

// Exported because this pill is HIDDEN below 768px now (TripHeader), and the
// same three counts have to stay readable in Trip settings or hiding it would
// silently cost them. Mitchell, Vercel toolbar comment on
// `/trips/:id?lens=Map&view=Calendar` at 411x760: "all three columns from
// share, trip overview to budget are really crowded and ugly on mobile, if we
// hid them here would they still be accessible in trip settings?" — for the
// stop and city counts the honest answer was *no*, nothing in the sheet
// showed them, so they moved there before anything was hidden here.
//
// One rule called twice, not a second derivation in the sheet: `chipModel` is
// where a day's city is decided (it walks that day's activities and resolves
// one city per day), so "how many cities" is only well defined in terms of it.
// A hand-rolled count in SettingsSheet would be free to disagree with the pill
// about the same trip, which is exactly the kind of drift that makes the
// settings copy untrustworthy the first time the two numbers differ.
export function tripCounts(detail: TripDetail): TripCounts {
  const cities = new Set(chipModel(detail).map((d) => d.city).filter((c): c is string => c !== null));
  return {
    days: detail.days.length,
    stops: detail.days.reduce((sum, d) => sum + d.activityIds.length, 0),
    cities: cities.size,
  };
}

/**
 * "Fri, Oct 9 – Fri, Oct 16", or "No dates set".
 *
 * Exported for the same reason `tripCounts` above is: the pill that used to be
 * this string's only reader is hidden below 768px, and SPEC §23 puts the date
 * range back on a phone as its own line under the trip title (`TripHeader`).
 * Lifted out of the pill's body rather than written a second time there —
 * `SettingsSheet`'s `datesLabel` is already a second copy of these three rules
 * (no dates / one date / a range), and a third would be the point at which the
 * header and the sheet start disagreeing about the same trip.
 *
 * Takes the detail, not two dates, because the range is derived from the DAYS:
 * `detail.startDate` is only the fallback for a trip whose days have not been
 * laid out yet.
 */
export function tripDateRange(detail: TripDetail): string {
  const days = detail.days;
  const start = days[0]?.date ?? detail.startDate;
  const end = days[days.length - 1]?.date ?? null;
  if (start === null) return "No dates set";
  if (end === null || end === start) return formatTripDate(start);
  return `${formatTripDate(start)} – ${formatTripDate(end)}`;
}

// Handoff `current/…dc.html:255-296`: a bordered pill — accent dot, date
// range, then (each separated by a divider) day/stop/city counts. The
// handoff also put a crew control here (stacked avatars + label, opening
// Trip settings); it was dropped in the 2026-08-30 design pass — see the
// comment where it used to sit.
export function TripMetaPill({ detail }: { detail: TripDetail }) {
  const days = detail.days;
  const { stops, cities } = tripCounts(detail);
  const dateRange = tripDateRange(detail);

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-hairline bg-surface py-1.5 pl-3 pr-3.5">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand" />
      <span className="font-mono text-xs text-ink">{dateRange}</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{days.length} days</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{stops} stops</span>

      <span aria-hidden className="h-3.5 w-px shrink-0 bg-hairline" />
      <span className="font-mono text-xs text-slate">{cities} cities</span>

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
