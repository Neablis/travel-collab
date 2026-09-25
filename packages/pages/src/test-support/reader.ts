import type { TimeFormat, UserPreferences } from "@tc/contracts";

/**
 * A signed-in reader whose only non-default choice is their clock — for the
 * widget tests that check a time prints in the READER's format
 * (`UserPreferences.timeFormat`), not the design's 12-hour default.
 */
export const readerOn = (timeFormat: TimeFormat): UserPreferences => ({
  displayName: null,
  homeAirport: null,
  distanceUnit: "km",
  timeFormat,
});
