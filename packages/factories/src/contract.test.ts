import { TripDetail } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { scenarios } from "./scenarios";
import { tripDetailFactory } from "./trip";

// The standing guard KI-38 did not have. `TripDetail` is a real runtime Zod
// schema, but the repo only ever imports it as `import type` — and `z.infer` of
// `z.string().uuid()` is just `string`. So for as long as the factory built
// malformed uuids for every activity and backlog id, TypeScript was content and
// nothing at runtime ever looked. This file is the "ever looks" part: it is a
// VALUE import of the same schema every server response is validated against,
// run over the shapes the factory can actually produce.
//
// Breadth is the point. A single spot check would have missed KI-38 too — the
// malformed group was `sequence + salt * 97`, so it depended on how many days
// and activities a build asked for, not on the trip being unusual.
function expectParses(label: string, trip: unknown): void {
  const parsed = TripDetail.safeParse(trip);
  const issues = parsed.success
    ? ""
    : parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  expect(parsed.success, `${label} failed TripDetail.parse():\n${issues}`).toBe(true);
}

type TransientCase = { label: string; transient: Record<string, unknown> };

// Every combination of the dimensions that change the built document's SHAPE:
// how many ids get minted and with which salts (dayCount x activitiesPerDay x
// unscheduledCount), whether activities carry a full geocoded location, a
// name-only one, or none, and whether they carry money. 11 activities per day
// is deliberate — it is past the point where a day's salt band would collide
// with the next day's under a fixed stride, and it drives salts well past
// KI-38's 676 trap.
const transientCases: TransientCase[] = [];
for (const dayCount of [0, 1, 3, 5]) {
  for (const activitiesPerDay of [0, 1, 2, 11]) {
    for (const unscheduledCount of [0, 1, 7]) {
      for (const located of [false, true, "named"] as const) {
        for (const costed of [false, true]) {
          transientCases.push({
            label: `days=${dayCount} perDay=${activitiesPerDay} backlog=${unscheduledCount} located=${located} costed=${costed}`,
            transient: {
              dayCount,
              activitiesPerDay,
              unscheduledCount,
              located,
              costed,
              currency: "USD",
              // A budget only where there is a cost to compare it against, so
              // both branches of `budgetRemaining` (a number, and null) are
              // parsed — including the negative, over-budget one.
              budget: costed ? { amountMinor: 1000, currency: "USD" } : null,
              startDate: dayCount > 0 ? "2027-06-01" : null,
            },
          });
        }
      }
    }
  }
}

describe("factory-built trips satisfy the TripDetail contract at runtime", () => {
  it("covers the full transient matrix", () => {
    // Deterministic census of the generator above (4 x 4 x 3 x 3 x 2). Not a
    // measured floor — the loops have no skipping precondition — but it does
    // catch a generator that quietly stops producing cases and leaves this
    // whole file passing on nothing.
    expect(transientCases).toHaveLength(288);
  });

  it.each(transientCases.map((c) => [c.label, c.transient] as const))(
    "tripDetailFactory: %s",
    (label, transient) => {
      expectParses(label, tripDetailFactory.build({}, { transient }));
    },
  );

  it.each(Object.keys(scenarios) as (keyof typeof scenarios)[])("scenarios.%s", (name) => {
    const trip = name === "mappedTrip" ? scenarios.mappedTrip(4) : scenarios[name]();
    expectParses(`scenarios.${name}`, trip);
  });

  // KI-38's own reproduction case, kept as a named witness rather than left to
  // be one row of the matrix above: `trip.ts` salts activity ids with
  // `1000 + dayIndex * activitiesPerDay + i` and backlog ids with `5000 + i`,
  // and `1000 * 97` already clears 0x10000 at sequence 1 — so before the fix
  // every activity and backlog id here was malformed while `tripId` and the
  // `dayId`s (salts 100 + dayIndex) stayed well-formed.
  it("mints valid uuids for the salt bands trip.ts actually uses", () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 3, activitiesPerDay: 12, unscheduledCount: 6 } });
    expectParses("KI-38 reproduction (3 days x 12 activities + 6 backlog)", trip);

    const ids = [trip.tripId, ...trip.days.flatMap((d) => [d.dayId, ...d.activityIds]), ...trip.backlog];
    expect(ids).toHaveLength(1 + 3 + 36 + 6);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.split("-").map((g) => g.length), id).toEqual([8, 4, 4, 4, 12]);
    }
  });
});
