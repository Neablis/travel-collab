// @tc/fixtures — curated, narratively real demo content, shared by every
// surface that needs it (ADR-030).
//
// Deliberately NOT @tc/factories. That package generates *anonymous* scenarios
// ("a" trip that is over budget) from faker and Fishery, for tests where the
// specific content is beside the point. This one owns *specific* content — the
// 14-day, 68-stop Japan trip the homepage renders — and carries no faker, no
// Fishery and no domain dependency at runtime, because a real Next.js route
// (api/dev/reset-demo-data) imports it and must not pull a test-data generator
// into the app bundle. That is the exact hazard ADR-020 rejected a
// `@tc/contracts/testing` export over.
//
// The dependency direction is @tc/factories -> @tc/fixtures, never the reverse.

export {
  JAPAN_BACKLOG,
  JAPAN_COUNTRY_CODE,
  JAPAN_STOPS,
  JAPAN_TRIP_BUDGET_USD,
  JAPAN_TRIP_CURRENCY,
  JAPAN_TRIP_DAY_COUNT,
  JAPAN_TRIP_NAME,
  JAPAN_TRIP_TRAVELLERS,
  type JapanBacklogItem,
  type JapanStop,
} from "./japan/trip.ts";

export {
  addDays,
  buildNotes,
  deterministicMintId,
  japanTripCommands,
  japanTripCommandGroups,
  locationName,
  unscheduledLocationName,
  type JapanTripOptions,
  type MintId,
} from "./japan/commands.ts";

export { CITY_OVERRIDES } from "./japan/cityOverrides.ts";
// The demo library (M11b). On the public surface for the same reason the trip
// rows are: data plus @tc/contracts types, with no @tc/domain and no generator
// behind it. `cities` is deliberately absent — it is derived by the domain's
// `citiesOfStops`, so whoever seeds these rows derives it exactly as `saveDay`
// does instead of reading an authored copy that could disagree.
export {
  JAPAN_SAVED_DAYS,
  JAPAN_SOURCE_TRIP,
  type JapanSavedDay,
  type JapanSavedDayAdd,
} from "./japan/savedDays.ts";

export { parseTripSeed, TripSeedV1 } from "./japan/seedSchema.ts";

// The starter library (2026-09-01): six curated, non-Japan days a fresh
// database has from its first seed, so somebody signing up meets a library with
// something worth taking in it rather than an empty Discover.
//
// Separate from `JAPAN_SAVED_DAYS` on purpose — that set's counts are what
// M11b's exit gate checks and `verify.ts` measures, and this one is content
// with no gate resting on it. See `./library/starterDays.ts`. Same public-surface
// terms as the rows above: plain data plus @tc/contracts types, no @tc/domain,
// because a real bundled route imports this package.
export {
  STARTER_SAVED_DAYS,
  STARTER_SOURCE_TRIP,
  type SeededSavedDay,
} from "./library/starterDays.ts";

// REFERENCE_START_DATE is the only part of the verification harness that
// belongs on the public surface — @tc/factories needs a fixed date so a test
// asserting on one does not depend on the day it runs.
//
// `verifyJapanTrip`, `formatReport` and the expectations are deliberately NOT
// re-exported. They import @tc/domain, and this package is imported by a real
// bundled route (api/dev/reset-demo-data); re-exporting them would pull the
// domain into that route's import graph through a package that exists to stay
// light. The tests and `pnpm seed:verify` import them by path instead, which is
// why @tc/domain is a devDependency here and not a dependency.
export { REFERENCE_START_DATE } from "./japan/trip.ts";
