// Every manifest field path that has ever been published, as a stored widget
// would name it. APPEND-ONLY: a path stays here after its field is renamed or
// removed, because a page written while it was live can still name it.
//
// `manifest.test.ts` holds the live manifest against this list. A path here
// that the manifest no longer publishes must be a `FIELD_CHANGES` entry in
// `pageDoc.ts` — that is what stops a field disappearing silently and leaving
// the pages that read it refused whole (M14 field-widget review, gap 1). A new
// published field is added here in the same change that annotates it.
export const PUBLISHED_FIELD_PATHS: readonly string[] = [
  // As of document v2 (M14 T08, 2026-09-24).
  "trip.days.index",
  "trip.days.date",
  "trip.days.cities",
  "trip.days.activityCount",
  "trip.days.costSubtotal",
  "trip.days.timeZone", // M14 T20
  "trip.cities.name",
  "trip.cities.dayIndexes",
  "trip.cities.activityCount",
  "trip.tags.tag",
  "trip.tags.activityCount",
  "trip.bookedCount",
  "trip.name",
  "trip.budgetRemaining",
  "trip.countdown",
  "account.name",
  "account.homeAirport",
  "stop.title",
  "stop.location",
  "stop.notes",
  "stop.kind",
  "stop.tags",
  "stop.cost",
];
