import type { TripDetail } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { cn } from "@/lib/cn";

export type ChipDay = {
  dow: string;
  dateNum: string;
  city: string | null;
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
// from the full place-name label). Falls back to location.name only for a
// location that predates that field, or one with no city-level address
// component at all (e.g. an ocean crossing, or a manually-typed place) — a
// real but imprecise stand-in, matching the same "don't fabricate a field
// that isn't there" stance as the TripSummary city comments in
// NextTripHero.tsx / TripCard.tsx. Falls through subsequent activityIds if
// the first has no location; null if none of the day's activities have one.
export function cityFor(day: TripDetail["days"][number], activities: TripDetail["activities"]): string | null {
  for (const activityId of day.activityIds) {
    const location = activities[activityId]?.location;
    if (location) return location.city ?? location.name;
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
    const transitionTo = previousCity !== null && city !== null && city !== previousCity ? city : null;
    previousCity = city;

    const dow =
      day.date === null
        ? `Day ${index + 1}`
        : parseLocalDate(day.date).toLocaleDateString("en-US", { weekday: "short" });
    const dateNum = day.date === null ? "" : String(parseLocalDate(day.date).getDate());

    return { dow, dateNum, city, transitionTo, stops: day.activityIds.length };
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
// transition line ("→ dest city"), line 4 stop dots. The transition line is
// a fixed h-3.5 (14px) slot rendered on every chip, empty or not, so the row
// doesn't jump height as a real timeline (Task 10) supplies real transitions.
// Clicking a chip calls onSelect — TripBoardScreen wires this straight to
// Task 4's useFocus().setFocusedDay; this component dispatches no trip
// command and knows nothing about the active lens.
export function DayChips({ days, focusedDay, onSelect }: DayChipsProps) {
  // One dayAccents() call over the whole trip's cities, so collisions
  // between two days of this trip get probed against each other rather than
  // each day resolving blind to every other one.
  const accents = dayAccents(days.map((d) => d.city));
  return (
    <div role="group" aria-label="Days" className="flex gap-2 overflow-x-auto pb-1">
      {days.map((day, index) => {
        const accent = accents[index] ?? { tint: "neutral", ink: "neutral", solid: "neutral" };
        const isFocused = focusedDay === index;
        return (
          <Button
            key={index}
            variant="ghost"
            aria-label={`${day.dow}${day.city ? `, ${day.city}` : ""}, ${day.stops} stop${day.stops === 1 ? "" : "s"}`}
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
            <span className="text-xs font-semibold text-ink">{day.dow}</span>
            <DataText size="xs" className="w-full truncate">
              {day.dateNum}
              {day.city ? ` ${day.city}` : ""}
            </DataText>
            <div
              data-testid="day-chip-transition"
              className="h-3.5 w-full truncate text-slate"
              // eslint-disable-next-line no-restricted-syntax -- 10px transition label has no token equivalent (below text-xs/12px), matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
              style={{ fontSize: "10px" }}
            >
              {day.transitionTo ? `→ ${day.transitionTo}` : null}
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
