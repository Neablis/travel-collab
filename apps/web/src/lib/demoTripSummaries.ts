import summaries from "./demoTripSummaries.generated.json";

// The demos' server-rendered summaries (M53 part 2): each demo's title, then
// each day with its stops as text, then the unscheduled rack's stops. A committed snapshot, written by
// `scripts/landing-demo.ts` from the same fold each board serves and
// drift-checked by `pnpm landing:verify`, because the summary sits behind
// the lint wall like the picker's cards do: it may not reach
// `@/server/demoTrip` or `@tc/domain` itself. Nothing here is reworded — the
// titles are the trips' and stops' own, as the fold carries them.

/** One day of a demo's summary: its ordinal name and its stops' titles, in order. */
export type DemoTripSummaryDay = {
  name: string;
  stops: string[];
};

/** One demo's summary: its title, every day with its stops as text, and the unscheduled rack's stops. */
export type DemoTripSummary = {
  slug: string;
  name: string;
  days: DemoTripSummaryDay[];
  /** The stops on no day (the board's unscheduled rack), in order. */
  unscheduled: string[];
};

/** Every demo's summary, in `DEMO_TRIPS` order. */
export const DEMO_TRIP_SUMMARIES: readonly DemoTripSummary[] = summaries;

/** The summary for demo `slug`, or undefined for a slug that is no demo. */
export function demoTripSummary(slug: string): DemoTripSummary | undefined {
  return DEMO_TRIP_SUMMARIES.find((summary) => summary.slug === slug);
}
