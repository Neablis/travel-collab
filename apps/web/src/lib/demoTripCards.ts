import type { DemoTripCard } from "./demoTrip";
import cards from "./demoTripCards.generated.json";

// The `/demo` picker's cards: each demo's name, length and description (M42
// D1, D8). A committed snapshot, written by `scripts/landing-demo.ts` from the
// same folds each board serves and drift-checked by `pnpm landing:verify`,
// because the description is `@tc/domain`'s rule and the picker sits behind
// the lint wall. Nothing on a card moves with the date, so a snapshot of it
// cannot go stale except by failing CI.

/** Every demo's card, in `DEMO_TRIPS` order. */
export const DEMO_TRIP_CARDS: readonly DemoTripCard[] = cards;

/** The card for demo `slug`, or undefined for a slug that is no demo. */
export function demoTripCard(slug: string): DemoTripCard | undefined {
  return DEMO_TRIP_CARDS.find((card) => card.slug === slug);
}
