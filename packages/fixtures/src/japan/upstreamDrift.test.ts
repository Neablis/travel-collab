// This package owns a COPY of the Japan trip. That is only safe if something
// notices when the original changes.
//
// The original is .design-sync/handoff/data/japan-trip-seed.json, an upstream
// drop re-synced from the design-system project. If a re-sync retimes a stop,
// renames a venue or reprices a day, ./trip.ts would go on serving the old
// content for ever and the only symptom would be a demo that no longer matches
// the design. This suite is what fails instead.
//
// It also pins the direction of ownership. Fields listed in
// NOT_CARRIED_FROM_UPSTREAM are ones the export has and we deliberately do not;
// the last test asserts that list is exhaustive, so a re-sync that ADDS a field
// cannot pass unnoticed either — someone has to decide whether it belongs in
// the fixture and say so here.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTripSeed } from "./seedSchema.ts";
import { CITY_OVERRIDES } from "./cityOverrides.ts";
import { KIND_OVERRIDES } from "./kindOverrides.ts";
import {
  JAPAN_BACKLOG,
  JAPAN_STOPS,
  JAPAN_TRIP_BUDGET_USD,
  JAPAN_TRIP_CURRENCY,
  JAPAN_TRIP_DAY_COUNT,
  JAPAN_TRIP_NAME,
} from "./trip.ts";

const SEED_PATH = new URL("../../../../.design-sync/handoff/data/japan-trip-seed.json", import.meta.url);
// Kept separately on purpose. `parseTripSeed` is a `z.object`, and zod STRIPS
// unknown keys — so a field a re-sync adds is gone from `seed` before anything
// can look at it. The content tests below want the parsed, validated value; the
// exhaustiveness test at the bottom must walk `raw`, or the one thing it exists
// to catch is the one thing it cannot see. (Found by CodeRabbit on PR #74;
// reproduced by adding a key to the raw object and watching it vanish from the
// parsed one.)
const raw = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Record<string, unknown>;
const seed = parseTripSeed(raw);

// Export fields ./trip.ts deliberately does not carry. Everything here is
// either derived, a computed rollup the domain owns, or another module's data.
// Inherited from japanTripImporter.ts's DROPPED_SEED_FIELDS (ADR-030).
const NOT_CARRIED_FROM_UPSTREAM = new Set([
  "$schema", // the file's own format tag
  "exportedAt", // export provenance, not trip content
  "note", // export provenance, not trip content
  "enums", // documents the file's own vocabulary
  "trip.id", // the prototype's string id; a real trip id is minted server-side
  "trip.state", // display workflow label ("Planning"); TripStatus is a different axis
  "trip.startDate", // the fixture is dated relative to today, never pinned (ADR-030)
  "trip.endDate", // derived from startDate + dayCount
  "trip.datesLabel", // derived display string
  "trip.dayCount", // derived from days.length
  "trip.stopCount", // derived from days[].stops.length
  "trip.cities", // derived from days[].city
  "trip.segments", // derived city/night grouping; no command models trip structure this way
  "trip.travelers", // Access & Membership's data (module map)
  "trip.budget.plannedTotal", // computed rollup — packages/domain's rollupCosts owns it
  "trip.budget.remaining", // computed rollup
  "trip.budget.over", // computed rollup
  "trip.budget.byCategory", // computed rollup
  "trip.budget.unpricedStops", // computed rollup
  "days[].label", // derived display string of date
  "days[].weekday", // derived from date
  "days[].dateOfMonth", // derived from date
  "days[].month", // derived from date
  "days[].year", // derived from date
  "days[].date", // the fixture's dates are relative; only the day's ORDER is carried
  "days[].previousCity", // no Day contract field
  "days[].isDayTrip", // no Day contract field
  "days[].dayCost", // computed rollup
  "days[].overlaps", // precomputed conflict data; the real engine derives these live (Invariant 3)
  "days[].stops[].durationMinutes", // redundant with start/end, which TimeWindow carries
  "days[].stops[].cost.currency", // trip-level, not per-event (ADR-008)
  "days[].stops[].cost.estimated", // Money is {amountMinor, currency} only
  "days[].stops[].cost.source", // same
  "unscheduled[].source", // carried, but as the item's `note` — see the backlog test below
]);

describe("the canonical copy still matches the design handoff export", () => {
  const upstreamStops = seed.days.flatMap((d) => d.stops.map((s) => ({ ...s, day: d.index, city: d.city })));

  it("carries the same trip-level facts", () => {
    expect(JAPAN_TRIP_NAME).toBe(seed.trip.name);
    expect(JAPAN_TRIP_DAY_COUNT).toBe(seed.days.length);
    expect(JAPAN_TRIP_BUDGET_USD).toBe(seed.trip.budget.total);
    expect(JAPAN_TRIP_CURRENCY).toBe(seed.trip.budget.currency);
  });

  it("carries the same stops, in the same order", () => {
    expect(JAPAN_STOPS).toHaveLength(upstreamStops.length);
    // One assertion over the whole list rather than 68 separate ones: a diff of
    // two arrays names every row that moved, where a per-row loop stops at the first.
    expect(
      JAPAN_STOPS.map((s) => ({
        id: s.id, day: s.day, title: s.title, place: s.place, area: s.area,
        start: s.start, end: s.end, city: s.city, kind: s.kind, costUsd: s.costUsd, note: s.note, who: s.who,
      })),
    ).toEqual(
      upstreamStops.map((s) => ({
        id: s.id, day: s.day, title: s.title, place: s.place, area: s.area,
        start: s.start, end: s.end,
        // `city` is the export's `days[].city` denormalised onto the stop,
        // EXCEPT where ./cityOverrides.ts declares a deliberate divergence.
        // Upstream has no per-stop city and tags a day with its DESTINATION,
        // which put the wrong city on seven travel-day rows (KI-59); the
        // override list carries those seven and nothing else.
        city: CITY_OVERRIDES[s.id]?.ours ?? s.city,
        // `kind` is compared against the export's `status` EXCEPT where
        // ./kindOverrides.ts declares a deliberate divergence, with a reason.
        // Everything else on the row is still verbatim, so a re-sync that
        // retimes or renames a stop fails here exactly as before — the override
        // list buys five rows of latitude and no more. The next test asserts
        // every listed override is real and actually applied, so a stale entry
        // cannot quietly widen this.
        kind: KIND_OVERRIDES[s.id]?.ours ?? s.status,
        costUsd: s.cost.amount, note: s.note, who: s.who,
      })),
    );
  });

  // Without this, an override could name a stop that no longer exists, or claim
  // an `upstream` value the export never had, and the suite above would simply
  // stop comparing that row — the list would become a way to switch the guard
  // off one id at a time.
  it("declares only kind overrides that are real, applied, and still needed", () => {
    for (const [id, override] of Object.entries(KIND_OVERRIDES)) {
      const upstream = upstreamStops.find((s) => s.id === id);
      expect(upstream, `${id} is not a stop in the export`).toBeDefined();
      expect(upstream!.status, `${id}'s recorded upstream value is stale`).toBe(override.upstream);
      const ours = JAPAN_STOPS.find((s) => s.id === id);
      expect(ours!.kind, `${id} does not actually carry its override`).toBe(override.ours);
      expect(override.ours, `${id} overrides to the same value it already had`).not.toBe(override.upstream);
      expect(override.why.length, `${id} has no reason recorded`).toBeGreaterThan(20);
    }
  });

  // Same guard as the one above, for the same reason: without it an entry could
  // name a stop that no longer exists, or record an `upstream` city the export
  // never had, and the comparison would simply stop checking that row. It also
  // fails an override that no longer overrides anything — a re-sync that fixes
  // `days[].city` upstream should delete the entry, not leave a no-op behind.
  it("declares only city overrides that are real, applied, and still needed", () => {
    for (const [id, override] of Object.entries(CITY_OVERRIDES)) {
      const upstream = upstreamStops.find((s) => s.id === id);
      expect(upstream, `${id} is not a stop in the export`).toBeDefined();
      expect(upstream!.city, `${id}'s recorded upstream city is stale`).toBe(override.upstream);
      const ours = JAPAN_STOPS.find((s) => s.id === id);
      expect(ours!.city, `${id} does not actually carry its override`).toBe(override.ours);
      expect(override.ours, `${id} overrides to the same city it already had`).not.toBe(override.upstream);
      expect(override.why.length, `${id} has no reason recorded`).toBeGreaterThan(20);
    }
  });

  it("carries the same backlog, with `source` as the item's note", () => {
    // The export has both `note` (always null for backlog items) and `source`
    // ("Priya added it"). The attribution is the useful half, so it is what the
    // fixture shows; nothing else reads `source`.
    expect(JAPAN_BACKLOG.map((b) => ({ id: b.id, title: b.title, place: b.place, area: b.area, kind: b.kind, note: b.note, who: b.who })))
      .toEqual(seed.unscheduled.map((u) => ({ id: u.id, title: u.title, place: u.place, area: u.area, kind: u.status, note: u.source, who: u.who })));
  });

  it("accounts for every field the export carries, including ones the schema would strip", () => {
    const paths = new Set<string>();
    /**
     * Collects every field path in the export, normalising array indices to
     * `[]` — so `days[3].stops[7].note` and `days[0].stops[0].note` are one
     * path, and a field is reported once however deep or repeated it is.
     */
    const walk = (value: unknown, prefix: string) => {
      if (Array.isArray(value)) {
        // EVERY element, not just the first. Sampling `value[0]` was defensible
        // while this walked the parsed seed — zod had already forced every
        // element to one shape. Walking the raw export, nothing has: a re-sync
        // that adds a field to stop 37 alone would be invisible. 72 stops is
        // not a cost worth optimising against that. (CodeRabbit, PR #74 —
        // a follow-on from its own parsed-vs-raw finding.)
        for (const element of value) walk(element, `${prefix}[]`);
        return;
      }
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        paths.add(path);
        walk(child, path);
      }
    };
    walk(raw, "");

    // Fields ./trip.ts carries, under the export's own names.
    const carried = new Set([
      "trip", "trip.name", "trip.budget", "trip.budget.total", "trip.budget.currency",
      "days", "days[].index", "days[].city", "days[].stops",
      "days[].stops[].id", "days[].stops[].title", "days[].stops[].place", "days[].stops[].area",
      "days[].stops[].start", "days[].stops[].end", "days[].stops[].status", "days[].stops[].note",
      "days[].stops[].who", "days[].stops[].cost", "days[].stops[].cost.amount",
      "unscheduled", "unscheduled[].id", "unscheduled[].title", "unscheduled[].place",
      "unscheduled[].area", "unscheduled[].status", "unscheduled[].note", "unscheduled[].who",
    ]);

    /**
     * Is this path, or any ancestor of it, on the not-carried list?
     *
     * Exclusion is inherited: listing `trip.travelers` covers
     * `trip.travelers[].name` without enumerating a shape we do not read.
     */
    const excluded = (path: string): boolean => {
      for (const p of NOT_CARRIED_FROM_UPSTREAM) {
        if (path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[`)) return true;
      }
      return false;
    };
    const unaccounted = [...paths].filter((p) => !carried.has(p) && !excluded(p));
    expect(unaccounted, "a re-sync added export fields — decide whether each belongs in ./trip.ts, then list it here").toEqual([]);
  });
});
