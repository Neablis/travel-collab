// The Japan demo trip, made available to tests through the same package they
// already import fixtures from.
//
// Deliberately NOT a `commandsFor` scenario name. `commandsFor` expands a
// `ScenarioSpec` — a day count, an activities-per-day count, cycled locations,
// indexed windows — which is the right shape for "a" trip that is over budget
// and the wrong shape for a specific one. Squeezing 68 hand-written stops into
// it would flatten them into exactly the placeholder data ADR-020 says
// `commandsFor` is for. So this is its own export, and it is a thin pass to
// @tc/fixtures rather than a second copy of anything.
//
// Reach for it when a test needs REAL richness — six cities, five kinds, four
// tags, coordinates on every stop, a genuine conflict — and for nothing else.
// It is 72 activities per setup, so a test that only needs "a trip with two
// days" should keep using `commandsFor`, which is far cheaper.

import type { TripCommand } from "@tc/contracts";
import { japanTripCommands, JAPAN_TRIP_NAME, REFERENCE_START_DATE } from "@tc/fixtures";
import { uuidFrom } from "./ids";

export { JAPAN_TRIP_NAME };

const JAPAN_ID_SALT = 8_100;

export type JapanTripOptions = {
  /**
   * `yyyy-mm-dd`. Defaults to @tc/fixtures's fixed reference date rather than
   * a relative one: a test that asserts on a date must not depend on the day
   * it runs. The real seeders pass a date relative to today; tests should not.
   */
  startDate?: string;
};

/**
 * Every command that builds the Japan trip, after `CreateTrip`.
 *
 * Ids are derived from @tc/factories's own deterministic `uuidFrom` sequence,
 * not `crypto.randomUUID` — same rule as every other factory here (ADR-020:
 * "a test using generated data must be reproducible from a recorded seed").
 */
export function japanTripCommandsFor(tripId: string, options: JapanTripOptions = {}): TripCommand[] {
  // Salted so these 86 ids (14 days + 72 activities) cannot collide with a
  // `commandsFor` trip built in the same test, which starts its own sequence
  // at 0 with the default salt.
  let n = 0;
  return japanTripCommands(tripId, {
    startDate: options.startDate ?? REFERENCE_START_DATE,
    mintId: () => uuidFrom(n++, JAPAN_ID_SALT),
  });
}
