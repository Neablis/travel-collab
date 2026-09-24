// @tc/pages — pure macro registry, resolvers, and template seeds.
// Depends on @tc/contracts only. No I/O, no clock, no randomness (Invariant 4).

export * from "./result";
export * from "./registry-types";
export * from "./external";
export * from "./chartPayloads";
export * from "./weatherPayload";
export * from "./registry";
export * from "./filters";
export * from "./select";
export * from "./insert";
export * from "./presets";
export * from "./templates";
export * from "./writeCheck";
export * from "./repeat";
export * from "./sentence";
export * from "./needsBooking";
export * from "./dayCity";
export * from "./enumLabels";
export * from "./kinds";
export * from "./fields";
export * from "./savedTemplate";
// The one reader of an instant in a named zone; the server's weather cuts its
// local days with it too, rather than a second `Intl` walk (review finding 6).
export { clockIn } from "./clock";
// The house 12-hour clock. `apps/web/src/lib/time.ts` re-exports it, so the
// board and the notebook print one format.
export { toClockLabel, toClockRange } from "./format";
// The one ordinal suffix table: the chart's axis here, and the Calendar cell's
// "14th" in `apps/web` (`ordinalDayOfMonth`), which delegates to it.
export { ordinal } from "./format";
