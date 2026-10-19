import type { ActivityView } from "@tc/contracts";
import type { ItineraryDayPayload, Seg, SunPayload, TripPeoplePayload, TripStripPayload } from "@tc/pages";
import type { AccentFamily } from "@/lib/dayAccent";
import type { DiscoverDay } from "@/lib/playbooks";
import snapshot from "./landingDemo.generated.json";
import features from "./landingFeatures.generated.json";

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

/**
 * The feature blocks' slice (M42 part 9), written by the same script and held
 * by the same verify step: the Playbooks block's cards, and the Notebook block's
 * page as segments and the blocks beside them.
 */
export type LandingFeatures = {
  /** Mitchell's published Hanoi playbook (`scripts/landing-day.json`), read through Discover's own `toDiscoverDay`. */
  playbook: DiscoverDay;
  /** The shelf's second day (M50 part 9): a library playbook from `content/playbooks/`, read the same way. */
  shelf: DiscoverDay;
  /** The page's paragraphs: the author's words and the widgets' resolved values. */
  memory: Seg[][];
  /** The page's block widgets (M50 part 9): the day it remembers, that day's daylight, and who was there. */
  page: {
    day: ItineraryDayPayload;
    sun: SunPayload;
    people: TripPeoplePayload;
  };
};

// Through `unknown` because JSON infers `kind: string` where the payloads say
// `"trip-strip"`. The shape is held by the generator's own return type, which
// tsc checks, and by the verify step, which holds this file to its output.
export const LANDING_DEMO = snapshot as unknown as LandingDemo;
export const LANDING_FEATURES = features as unknown as LandingFeatures;

/**
 * The closing quote on both front doors (M50 part 5): the Notebook page's last
 * paragraph, read here so that a regenerated page changes the quote with it.
 */
export const LANDING_CLOSING_QUOTE = (LANDING_FEATURES.memory.at(-1) ?? []).map((seg) => seg.text).join("");
