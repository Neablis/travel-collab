// The rule lives in `@tc/pages` since 2026-09-24, so the notebook's "Still to
// book" widget reads the same predicate as the Calendar and the home hero. This
// re-export keeps every `@/lib/needsBooking` import where it was.
export { needsBooking, type BookableStop } from "@tc/pages";
