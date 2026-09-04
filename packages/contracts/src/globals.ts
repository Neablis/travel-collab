import { z } from "zod";
import { ActivityTag } from "./activity";
import { described, type ValueKind } from "./valueKind";

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
// Every readable field goes through `described(kind, label, schema)` rather
// than a bare `.describe()`. Two things ride on that one line: the human label
// the picker shows, and the VALUE KIND that tells a generic widget how to
// render it (ADR-037 open question 4 — *"'how to serialize them' becomes a
// small closed set of value kinds — money, date, count, text, duration — each
// with one formatter"*).
//
// The kind was missing until Copilot pointed it out on PR 134: with label only,
// `costSubtotal` was indistinguishable from `activityCount`, so the manifest
// could name a field and still not say how to print it — which is most of what
// it exists to do.

export const TripGlobalsDay = z.object({
  index: described("count", "Day number, counting from 0", z.number().int().nonnegative()),
  date: described("date", "The day's date, or nothing if the trip has no start date", z.string().nullable()),
  // From `citiesOfDay`, which is the ONE implementation of this rule and says
  // why in its own header: time order not stored order, `location.city` only
  // (never a name/area fallback), duplicates collapsed. A day that touches no
  // located stop reports `[]`.
  cities: described("text", "The cities this day touches, in arrival order", z.array(z.string())),
  activityCount: described("count", "How many stops are on this day", z.number().int().nonnegative()),
  costSubtotal: described("money", "What this day costs", z.number().int()),
});
export type TripGlobalsDay = z.infer<typeof TripGlobalsDay>;

export const TripGlobalsCity = z.object({
  name: described("text", "The city's name", z.string()),
  dayIndexes: described("count", "Which days touch this city", z.array(z.number().int().nonnegative())),
  activityCount: described("count", "How many stops are in this city", z.number().int().nonnegative()),
});
export type TripGlobalsCity = z.infer<typeof TripGlobalsCity>;

export const TripGlobalsTag = z.object({
  tag: described("text", "The tag", ActivityTag),
  activityCount: described("count", "How many stops carry this tag", z.number().int().nonnegative()),
});
export type TripGlobalsTag = z.infer<typeof TripGlobalsTag>;

// The trip's addressable collections. `people` is deliberately absent: nothing
// links an activity to a person, and the attribution model that would fix it
// was deferred out of M14 on 2026-09-03 (M13 `add-stop-who` / M19 link 3). An
// empty `people: []` here would be worse than its absence — it would read as
// "this trip has nobody on it" rather than "this build cannot answer that".
export const TripGlobals = z.object({
  days: described("text", "Every day of the trip", z.array(TripGlobalsDay)),
  cities: described("text", "Every city the trip touches", z.array(TripGlobalsCity)),
  tags: described("text", "Every tag in use on this trip", z.array(TripGlobalsTag)),
  bookedCount: described("count", "How many stops are booked", z.number().int().nonnegative()),
});
export type TripGlobals = z.infer<typeof TripGlobals>;
export type { ValueKind };
