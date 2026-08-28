import type { TripDetail } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

export type ChipDay = {
  dow: string;
  dateNum: string;
  city: string | null;
  // The city this day arrived FROM — the previous day's derived city, set only
  // when it differs from this day's. Named "from" rather than "to" because
  // that is what it has always held the other half of: `transitionTo` was, by
  // construction, `city` itself (see chipModel), so the two could never carry
  // different information. Storing the from-half is what lets a chip render a
  // real "Tokyo → Nikkō" instead of "Nikkō → Nikkō".
  transitionFrom: string | null;
  transitionTo: string | null;
  stops: number;
};

// Same static-map pattern as Sparkline.tsx's BAR_BG / TripCard.tsx's
// ACCENT_BAR_BG: Tailwind's JIT scanner can't see a template-interpolated
// `bg-${x}-tint`, so this is the only route from an AccentFamily to a real
// class. `--color-*-tint` exists for all five named families (globals.css).
const CHIP_BG: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

const DOT_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};

// "danger"/"warning"/"success"/"info" each carry a `-ink` token; "brand" does
// not (its darkest tone is `-pressed`) — same map shape as TimelineLens.tsx's
// and KeepDayFlag.tsx's own INK_TEXT. Static Record, not a template string:
// Tailwind only emits utilities it can see as literal text.
const INK_TEXT: Record<AccentFamily, string> = {
  brand: "text-brand-pressed",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-slate",
};

// Dates are calendar dates (YYYY-MM-DD), not instants — construct in local
// time so "2027-06-01" never rolls back a day in a negative-offset zone.
// Mirrors lib/formatDate.ts's own local-parse helper; that module only
// exports pre-formatted strings (day-of-week + month + day together), not a
// bare Date, so this is a small local copy — exported so NextTripHero.tsx's
// sparkline day-number derivation reuses it rather than a third copy.
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

// The first scheduled activity's location.city (packages/contracts'
// Location.city — the geocoder's own structured city/town/village, distinct
// from the full place-name label).
//
// `city` stays FIRST here, unlike shortPlace() (lib/place.ts), which leads
// with `area`. This value names the day and drives the day accent and the
// "Tokyo → Nikkō" transition, so a ward or neighbourhood in this slot would
// split one city's days apart and invent transitions inside a single city.
// `area` is the fallback instead of `name`: when there is no city at all, a
// real locality ("Higashiyama") is a truer stand-in for the day's whereabouts
// than the venue name ("Kiyomizu-dera") that stood here before — that
// mismatch was KI-35. `name` remains the last resort for a location carrying
// neither structured field (an ocean crossing, a manually-typed place),
// matching the same "don't fabricate a field that isn't there" stance as the
// TripSummary city comments in NextTripHero.tsx / TripCard.tsx.
//
// Falls through subsequent activityIds if the first has no location; null if
// none of the day's activities have one.
export function cityFor(day: TripDetail["days"][number], activities: TripDetail["activities"]): string | null {
  for (const activityId of day.activityIds) {
    const location = activities[activityId]?.location;
    if (location) return location.city ?? location.area ?? location.name;
  }
  return null;
}

// Pure: one ChipDay per TripDetail day, no DOM — testable standalone
// (mirrors Sparkline.tsx's sparklineBars). transitionTo is set only when
// this day's derived city differs from the *previous* day's derived city
// and both are non-null, so a day with no located activity (or the very
// first day, which has no previous day at all) never claims a fake
// transition.
export function chipModel(detail: TripDetail): ChipDay[] {
  let previousCity: string | null = null;

  return detail.days.map((day, index) => {
    const city = cityFor(day, detail.activities);
    const moved = previousCity !== null && city !== null && city !== previousCity;
    const transitionFrom = moved ? previousCity : null;
    const transitionTo = moved ? city : null;
    previousCity = city;

    const dow =
      day.date === null
        ? `Day ${index + 1}`
        : parseLocalDate(day.date).toLocaleDateString("en-US", { weekday: "short" });
    const dateNum = day.date === null ? "" : String(parseLocalDate(day.date).getDate());

    return { dow, dateNum, city, transitionFrom, transitionTo, stops: day.activityIds.length };
  });
}

export type DayChipsProps = {
  days: ChipDay[];
  focusedDay: number | null;
  onSelect: (index: number) => void;
};

// Handoff README §2 "Day chips row" + prototype `data-r` chips: a
// horizontally scrolling row of 92px, 12px-radius (rounded-lg), day-tinted
// chips — line 1 day-of-week, line 2 mono date number + city, line 3 the
// transition line, line 4 stop dots. The transition line is a fixed h-3.5
// (14px) slot rendered on every chip, empty or not, so the row doesn't jump
// height as a real timeline (Task 10) supplies real transitions.
//
// The handoff draws line 3 as "→ dest city", which this built as a bare
// `→ ${transitionTo}` under a line-2 city — and since transitionTo WAS
// line 2's city (chipModel set it to `city` itself), every travel chip read
// its destination twice: "Nikkō" over "→ Nikkō" (Mitchell, preview feedback
// on PR #55: "Shouldnt this be Tokyo for the city? Since it ends the day in
// Nikko?"). The arrow only means anything with both ends, so line 3 now
// spells out the whole move and line 2 yields the city to it on those days.
// TimelineLens had already worked around the same gap by reaching back to
// `days[index - 1].city` for its travel pill's "from" — it now reads
// transitionFrom instead, so the two surfaces derive the move once.
// Clicking a chip calls onSelect — TripBoardScreen wires this straight to
// Task 4's useFocus().setFocusedDay; this component dispatches no trip
// command and knows nothing about the active lens.
export function DayChips({ days, focusedDay, onSelect }: DayChipsProps) {
  // One dayAccents() call over the whole trip's cities, so collisions
  // between two days of this trip get probed against each other rather than
  // each day resolving blind to every other one.
  const accents = dayAccents(days.map((d) => d.city));
  return (
    // Reported three times ("top border cut off"/"still cut off"/"border on
    // the left side here is cut off"): `overflow-x-auto` sets overflow-x to a
    // non-`visible` value, and the CSS overflow spec forces the paired
    // overflow-y (left at its `visible` default) to compute as `auto` too — so
    // this container clips on every side even though only the x-axis was ever
    // meant to scroll. `pb-1` already gave the focused chip's `ring-2`
    // clearance below the clip edge and `pt-1` covered the symmetric case
    // above; the horizontal axis was still flush, so focusing the FIRST chip
    // clipped the left half of its ring against the scroll origin (and the
    // last chip's right half at the far end).
    //
    // `px-1` with a matching `-mx-1` rather than bare padding: padding inside
    // a scroll container would indent the row from the header's own `px-6`
    // gutter, so the negative margin gives the ring its gutter back without
    // moving where the chips sit. Same pairing as `ui/sheet.tsx`, which needed
    // it for the same reason on the vertical axis.
    <div role="group" aria-label="Days" className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-1">
      {days.map((day, index) => {
        const accent = accents[index] ?? { tint: "neutral", ink: "neutral", solid: "neutral" };
        const isFocused = focusedDay === index;
        return (
          <Button
            key={index}
            variant="ghost"
            aria-label={`${day.dow}${
              day.transitionTo ? `, ${day.transitionFrom} to ${day.transitionTo}` : day.city ? `, ${day.city}` : ""
            }, ${day.stops} stop${day.stops === 1 ? "" : "s"}`}
            aria-pressed={isFocused}
            onClick={() => onSelect(index)}
            className={cn(
              "h-auto shrink-0 flex-col items-start justify-start gap-1 rounded-lg p-2 text-left hover:opacity-90",
              CHIP_BG[accent.solid],
              isFocused && "ring-2 ring-brand",
            )}
            // eslint-disable-next-line no-restricted-syntax -- 92px chip width has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
            style={{ width: "92px" }}
          >
            <span className={cn("text-xs font-semibold", INK_TEXT[accent.ink])}>{day.dow}</span>
            <div className="flex w-full items-baseline gap-1 overflow-hidden">
              <DataText size="xs" className="shrink-0">
                {day.dateNum}
              </DataText>
              {/* On a travel day the city moves down to the transition line, which
                  spells out both ends of the move — printing it here as well would
                  be the same fact twice on one chip (RULES.md 4), and printing it
                  here alone is what produced the reported "Nikkō" over "→ Nikkō". */}
              {day.city && !day.transitionTo ? (
                <span
                  className="truncate text-slate"
                  // eslint-disable-next-line no-restricted-syntax -- 10px city label has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                  style={{ fontSize: "10px" }}
                >
                  {day.city}
                </span>
              ) : null}
            </div>
            <div
              data-testid="day-chip-transition"
              className="h-3.5 w-full truncate text-slate"
              // eslint-disable-next-line no-restricted-syntax -- 10px transition label has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
              style={{ fontSize: "10px" }}
            >
              {day.transitionTo ? `${day.transitionFrom} → ${day.transitionTo}` : null}
            </div>
            <div className="flex flex-wrap gap-0.5" aria-hidden>
              {Array.from({ length: day.stops }, (_, dotIndex) => (
                <span
                  key={dotIndex}
                  className={cn("w-2 rounded-full", DOT_BG[accent.solid])}
                  // eslint-disable-next-line no-restricted-syntax -- 3px stop-dot height has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
                  style={{ height: "3px" }}
                />
              ))}
            </div>
          </Button>
        );
      })}
    </div>
  );
}
