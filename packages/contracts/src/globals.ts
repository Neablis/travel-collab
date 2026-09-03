import { z } from "zod";
import { ActivityTag } from "./activity";

// The trip's addressable collections — ADR-037 open question 4's "trip globals",
// and the prerequisite that makes half the widget catalogue cheap.
//
// Mitchell, 2026-09-03:
//
// > I'm hoping we have some list of project level objects that can be
// > generically rendered […] a trip attribute widget, and it would have all
// > those trip globals, including all the cities
//
// **Why it is a contract rather than a function widgets call.** `trip.cities` is
// not stored: cities are derived per-activity from `location.city`, by
// `citiesOfDay` in `@tc/domain` — and AGENTS.md's module map makes
// `apps/web/src/server/**` the ONLY code that may import `@tc/domain`. Three
// files in `apps/web/src/lib` (`time.ts`, `geo.ts`, `dates.ts`) each reimplement
// domain-free math rather than breach that wall, so routing around it to reach
// one function would be the odd one out, and it would put domain code in the
// browser bundle through a side door.
//
// So this follows the path `TripDetail` itself already takes: **derived on the
// server where domain is allowed, described here, delivered to the client.**
// That is also what makes ADR-037 open question 4's settled answer possible —
// the attribute manifest is built by inverting THIS schema, and a projection
// computed in the browser would have no schema to invert.
//
// `.describe()` on every field is load-bearing rather than documentation: it is
// the human label the manifest reads (Mitchell: *"we can invert a Typescript
// type to identify the fields that can be accessed"*, refined to Zod because in
// this repo the type is the derived artifact, not the source).

export const TripGlobalsDay = z.object({
  index: z.number().int().nonnegative().describe("Day number, counting from 0"),
  date: z.string().nullable().describe("The day's date, or nothing if the trip has no start date"),
  // From `citiesOfDay`, which is the ONE implementation of this rule and says
  // why in its own header: time order not stored order, `location.city` only
  // (never a name/area fallback), duplicates collapsed. A day that touches no
  // located stop reports `[]`.
  cities: z.array(z.string()).describe("The cities this day touches, in arrival order"),
  activityCount: z.number().int().nonnegative().describe("How many stops are on this day"),
  costSubtotal: z.number().int().describe("What this day costs, in minor units"),
});
export type TripGlobalsDay = z.infer<typeof TripGlobalsDay>;

export const TripGlobalsCity = z.object({
  name: z.string().describe("The city's name"),
  dayIndexes: z.array(z.number().int().nonnegative()).describe("Which days touch this city"),
  activityCount: z.number().int().nonnegative().describe("How many stops are in this city"),
});
export type TripGlobalsCity = z.infer<typeof TripGlobalsCity>;

export const TripGlobalsTag = z.object({
  tag: ActivityTag.describe("The tag"),
  activityCount: z.number().int().nonnegative().describe("How many stops carry this tag"),
});
export type TripGlobalsTag = z.infer<typeof TripGlobalsTag>;

// The trip's addressable collections. `people` is deliberately absent: nothing
// links an activity to a person, and the attribution model that would fix it
// was deferred out of M14 on 2026-09-03 (M13 `add-stop-who` / M19 link 3). An
// empty `people: []` here would be worse than its absence — it would read as
// "this trip has nobody on it" rather than "this build cannot answer that".
export const TripGlobals = z.object({
  days: z.array(TripGlobalsDay).describe("Every day of the trip"),
  cities: z.array(TripGlobalsCity).describe("Every city the trip touches"),
  tags: z.array(TripGlobalsTag).describe("Every tag in use on this trip"),
  bookedCount: z.number().int().nonnegative().describe("How many stops are booked"),
});
export type TripGlobals = z.infer<typeof TripGlobals>;
