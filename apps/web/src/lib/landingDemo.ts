import type { ActivityView } from "@tc/contracts";
import type { ItineraryDayPayload, TripStripPayload } from "@tc/pages";
import type { AccentFamily } from "@/lib/dayAccent";
import snapshot from "./landingDemo.generated.json";

// The slice of the `/demo` trip the front door's hero draws with real
// components (docs/specs/2026-09-27-link-previews-and-real-hero-design.md §3).
//
// A committed snapshot because the landing may not fetch (SPEC §14) and may not
// import `@/server/demoTrip` or `@tc/domain` (the lint wall). It is written by
// `scripts/landing-demo.ts` from the same fold `/demo` serves, and
// `pnpm landing:verify` (and `landing-demo.test.ts` inside `pnpm test`)
// regenerates it and fails on any difference, so it can only go stale by
// failing CI.
//
// No calendar dates anywhere in it: `/demo` shifts its dates to always be
// upcoming, and a frozen date on the landing would be a claim about a trip
// happening on a day that has passed. The generator resolves the widgets
// against the trip with its dates removed, so the blocks print the undated
// forms they already have ("Day 5 · Tokyo · 5 stops").

export type LandingDemo = {
  currency: string;
  /** Each day's colour family by `dayId`, as `cityAccents` answers it on the board. */
  accents: Record<string, AccentFamily>;
  /** One day of the trip, as `DayRiver` takes it. */
  river: {
    dayId: string;
    ordinal: number;
    city: string;
    activityIds: string[];
    activities: Record<string, ActivityView>;
  };
  /** The notebook panel's widgets, resolved by `@tc/pages` exactly as a notebook resolves them. */
  notebook: {
    strip: TripStripPayload;
    day: ItineraryDayPayload;
  };
};

// Through `unknown` because JSON infers `kind: string` where the payloads say
// `"trip-strip"`. The shape is held by the generator's own return type, which
// tsc checks, and by the verify step, which holds this file to its output.
export const LANDING_DEMO = snapshot as unknown as LandingDemo;
