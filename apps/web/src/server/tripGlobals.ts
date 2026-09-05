import { citiesOfDay } from "@tc/domain";
import type { TripDetail, TripGlobals, TripGlobalsCity, TripGlobalsTag } from "@tc/contracts";

// Builds the trip's addressable collections (ADR-037 open question 4).
//
// **This lives under `src/server/**` because that is the only place allowed to
// import `@tc/domain`** (AGENTS.md's module map), and the city rule it needs —
// `citiesOfDay` — lives there. Computing it here rather than in the browser is
// the whole reason `TripGlobals` is a contract type: see that file's header.
//
// Pure, and deliberately so: it reads a `TripDetail` it is handed and performs
// no I/O, which keeps it testable without a database and rebuildable from
// nothing but a projection that already exists.
export function buildTripGlobals(detail: TripDetail): TripGlobals {
  const days = detail.days.map((day, index) => ({
    index,
    date: day.date,
    // Not reimplemented here. `citiesOfDay` is the ONE implementation of this
    // rule (time order, `location.city` only, duplicates collapsed) and its own
    // header explains why a second one is how a profile's numbers come to
    // contradict Discover's.
    cities: citiesOfDay(detail, index),
    activityCount: day.activityIds.length,
    costSubtotal: day.costSubtotal,
  }));

  // A city's days and its stop count, accumulated in one pass over the days
  // above so the two can never disagree about which days a city is on.
  const cityIndex = new Map<string, { dayIndexes: number[]; activityCount: number }>();
  for (const day of days) {
    for (const name of day.cities) {
      const entry = cityIndex.get(name) ?? { dayIndexes: [], activityCount: 0 };
      entry.dayIndexes.push(day.index);
      cityIndex.set(name, entry);
    }
  }
  // Stop counts are attributed by the stop's OWN city, not by its day's city
  // list: a travel day touches two cities and its stops are not evenly split
  // between them. Counting per day would double-count every stop on such a day.
  //
  // A city met here for the first time is CREATED rather than skipped, with no
  // days behind it. That is the backlog: an unscheduled stop is in a city the
  // trip plans to visit, and it belongs in a collection whose field says "how
  // many stops are in this city".
  //
  // Skipping it was not merely an omission, it was inconsistent — the earlier
  // version incremented an existing entry for any activity, so a backlog stop
  // COUNTED when some unrelated day happened to visit its city and vanished
  // when none did. Found by CodeRabbit on #134.
  for (const activity of Object.values(detail.activities)) {
    const name = activity.location?.city;
    if (!name) continue;
    const entry = cityIndex.get(name) ?? { dayIndexes: [], activityCount: 0 };
    entry.activityCount += 1;
    cityIndex.set(name, entry);
  }
  const cities: TripGlobalsCity[] = [...cityIndex.entries()]
    .map(([name, entry]) => ({ name, dayIndexes: entry.dayIndexes, activityCount: entry.activityCount }));

  const tagCounts = new Map<TripGlobalsTag["tag"], number>();
  let bookedCount = 0;
  for (const activity of Object.values(detail.activities)) {
    if (activity.kind === "booked") bookedCount += 1;
    // DEDUPED per activity. `tags` is `z.array(ActivityTag)` with no uniqueness
    // refinement, so `["meal", "meal"]` is valid stored data — and the field
    // this feeds says "how many STOPS carry this tag", not how many tag entries
    // exist. Counting the raw array reported one stop twice. Found by Copilot
    // on PR 134.
    for (const tag of new Set(activity.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const tags: TripGlobalsTag[] = [...tagCounts.entries()].map(([tag, activityCount]) => ({ tag, activityCount }));

  return { days, cities, tags, bookedCount };
}
