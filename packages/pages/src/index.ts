// @tc/pages — pure macro registry, resolvers, and template seeds.
// Depends on @tc/contracts only. No I/O, no clock, no randomness (Invariant 4).

export * from "./result";
export { countryFacts } from "./data/countries";
export * from "./registry-types";
export * from "./external";
export * from "./chartPayloads";
export * from "./widgetView";
export * from "./weatherPayload";
export * from "./sunPayload";
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
// M30 (ADR-056): link targets, the notebook preview line, the printed itinerary.
export * from "./linkTarget";
export * from "./itineraryPayload";
export { WebAddress, hostOf } from "./macros/primitives/link";
// What a widget calls a member when `WidgetContext.people` has no name for them;
// the person select in `apps/web` labels its options with the same rule.
export { FORMER_MEMBER, personNames } from "./macros/primitives/balances";
export { ASSISTANT_NAME } from "./macros/primitives/chatRecent";
// The one reader of an instant in a named zone; the server's weather cuts its
// local days with it too, rather than a second `Intl` walk (review finding 6).
export { clockIn, isKnownZone } from "./clock";
// The one clock-time formatter, in the reader's 12- or 24-hour clock.
// `apps/web/src/lib/time.ts` re-exports it, so the board and the notebook
// print one format.
export { readerClock, toClockLabel, toClockRange } from "./clockLabel";
// The one ordinal suffix table: the chart's axis here, and the Calendar cell's
// "14th" in `apps/web` (`ordinalDayOfMonth`), which delegates to it. The
// countdown and the day's name are Home's badge's words too (M52).
export { ordinal, formatShortDate, formatCountdown, dayLabel } from "./format";
export * from "./widgetSearch";
export * from "./defaultNotebooks";
// M52 (ADR-080): where a trip is right now. Every reader of "now" asks this,
// and none works out a phase of its own.
export * from "./now";
export * from "./dateScope";
export { nowAndNext } from "./macros/primitives/nowNext";
export { hasDirections, NOTHING_MORE_TODAY } from "./macros/primitives/directions";
