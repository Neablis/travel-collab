import type { TripDetail } from "@tc/contracts";
import { cityFor } from "@/components/trip/DayChips";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";

// Which colour a city wears **on a notebook page**, answered by the SAME
// derivation the board answers it with.
//
// This exists as its own module rather than as a map inside a widget because
// of a bug this repo has already paid for once: the home hero coloured cities
// from its own hashed palette while Board/Column/DayChips coloured them from
// `dayAccents`' five semantic families, and the two had no reason to agree —
// *"the colors here for each location doesn't match the color you applied in
// the timeline and columns for the cities"* (Mitchell). The fix was one
// derivation, and `dayAccentConsistency.property.test.ts` pins it.
//
// A notebook widget naming a city is a third surface with the same obligation,
// so it does not hash anything of its own: it feeds `dayAccents` the identical
// input the board feeds it — one `cityFor` per day, in day order. `dayAccents`
// assigns per TRIP (it dedupes and sorts before probing), so the same trip
// always yields the same assignment whichever surface asks.
//
// Colour is decided HERE, in `apps/web`, and never in `packages/pages`: a
// resolver answers what a line means, a renderer answers what it looks like
// (ADR-037 decision 1). The payload carries a city's NAME; this turns a name
// into a family, and the maps below turn a family into a class.
export interface CityAccents {
  // `null` (no city, or a city this trip doesn't contain) is "neutral", which
  // is a real answer: a day with no located stop has no colour, and inventing
  // one would claim a place the trip never named.
  ofCity: (city: string | null) => AccentFamily;
  // Keyed on the day's id, not its position: a block payload carries `dayId`
  // and a widget that renders a SUBSET of the days would silently colour the
  // wrong ones off an index.
  ofDayId: (dayId: string) => AccentFamily;
}

// Same static-map pattern as CalendarLens.tsx's INK_TEXT / TimelineLens.tsx's
// TINT_BG, and for the same reason: Tailwind's JIT scanner cannot see a
// template-interpolated `text-${family}-ink`. ("brand"'s darkest tone is
// `-pressed`, not a `-ink` token — there is no `--color-brand-ink`.)
export const CITY_INK: Record<AccentFamily, string> = {
  brand: "text-brand-pressed",
  info: "text-info-ink",
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "text-slate",
};

export const CITY_TINT: Record<AccentFamily, string> = {
  brand: "bg-brand-tint",
  info: "bg-info-tint",
  success: "bg-success-tint",
  warning: "bg-warning-tint",
  danger: "bg-danger-tint",
  neutral: "bg-moss",
};

const NEUTRAL: CityAccents = { ofCity: () => "neutral", ofDayId: () => "neutral" };

export function cityAccents(detail: TripDetail | null): CityAccents {
  if (detail === null) return NEUTRAL;
  // `cityFor(day, activities)` per day, in day order — `chipModel`'s `city`
  // field is this exact call, so the board and this build `dayAccents`' input
  // from the same function rather than from two readings of "a day's city".
  const perDay = detail.days.map((day) => cityFor(day, detail.activities));
  const accents = dayAccents(perDay);
  const byCity = new Map<string, AccentFamily>();
  const byDayId = new Map<string, AccentFamily>();
  perDay.forEach((city, index) => {
    const family = accents[index]!.ink;
    byDayId.set(detail.days[index]!.dayId, family);
    if (city !== null) byCity.set(city, family);
  });
  return {
    ofCity: (city) => (city === null ? "neutral" : (byCity.get(city) ?? "neutral")),
    ofDayId: (dayId) => byDayId.get(dayId) ?? "neutral",
  };
}
