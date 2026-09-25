// The round trip, at the layer that owns it: **bundle → commands → state →
// `TripDetail` → bundle**, with no database anywhere.
//
// This is M25's thesis box, and it belongs here rather than in an integration
// test because nothing about "did every field survive" needs Postgres. What the
// `int` suite proves instead is what only it can: that the ENDPOINTS mint fresh
// ids, take ownership from the session and refuse what they should. Proving
// field equality twice would cost two maintenance sites and catch one bug
// (AGENTS.md, *prove it at one layer*).
//
// **The trip is built through the real command path** — `decideTripCommand` +
// `evolveTrip` + `tripDetailFromState`, the same three functions the server
// runs — so a bundle that produces commands the domain would refuse fails here
// rather than passing against a hand-assembled rollup. `@tc/domain` is a
// devDependency of this package for exactly this.
//
// **Data is hand-written rather than taken from `@tc/factories`**, which is the
// one exception AGENTS.md's testing law allows and for the identical reason it
// allows it in `packages/domain`: `packages/factories` depends on
// `@tc/fixtures`, so importing it here would be an import cycle. The commands
// below are what a person's real actions would have produced, which is the
// property that actually matters.

import { describe, expect, it } from "vitest";
import {
  decideTripCommand,
  evolveTrip,
  tripDetailFromState,
  type TripState,
} from "@tc/domain";
import { TripCommand, type TripDetail } from "@tc/contracts";
import { ContentBundleV1, parseBundle, type BundleTrip } from "./schema.ts";
import { bundleTripCommandGroups } from "./toCommands.ts";
import { bundleKeyFor, tripToBundle } from "./fromTrip.ts";

const TODAY = "2026-09-19";
const CREATED_AT = "2026-09-19T09:00:00.000Z";
const ACTOR = "google-someone";
const TRIP_ID = "11111111-1111-4111-8111-111111111111";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

/** Run commands the way the server does, and refuse to paper over a rejection. */
function run(commands: unknown[]): TripDetail {
  let state: TripState | null = null;
  for (const raw of commands) {
    const command = TripCommand.parse(raw);
    const decision = decideTripCommand(state, command, { actorId: ACTOR });
    if (!decision.ok) {
      throw new Error(`the domain refused ${command.type}: ${decision.rejection.message}`);
    }
    for (const event of decision.events) state = evolveTrip(state, event);
  }
  if (state === null) throw new Error("no commands");
  return tripDetailFromState(state, CREATED_AT);
}

/** A bundle trip, imported as a NEW trip — fresh ids, which is link 3's rule. */
function importTrip(trip: BundleTrip, tripId = TRIP_ID): TripDetail {
  const groups = bundleTripCommandGroups("round-trip", trip, {
    today: TODAY,
    tripId,
    mintId: ids(),
  });
  return run([{ type: "CreateTrip", tripId, name: trip.name }, ...groups.flat()]);
}

const stop = (over: Record<string, unknown> = {}) => ({ title: "A stop", ...over });

const source = (over: Record<string, unknown> = {}) =>
  parseBundle({
    $schema: "travel-collab/content-bundle/v1",
    bundle: { id: "round-trip", name: "Round trip", origin: "human" },
    trips: [
      {
        key: "kyoto",
        name: "Kyoto",
        startDate: "2027-03-14",
        days: [
          {
            stops: [
              stop({
                title: "Fushimi Inari",
                timeWindow: { start: "09:00", end: "11:30" },
                location: { name: "Fushimi Inari Taisha", lat: 34.9671, lng: 135.7727, city: "Kyoto", countryCode: "JP" },
                notes: "Go early, the gates are empty before nine.",
                kind: "booked",
                tags: ["outdoors"],
                cost: { amountMinor: 0, currency: "JPY" },
              }),
              stop({ title: "Lunch", timeWindow: { start: "12:00", end: "13:00" } }),
              // M24's travel leg, so the thesis above holds for it too.
              stop({
                title: "Train to Arashiyama",
                kind: "transit",
                location: { name: "Kyoto Station" },
                mode: "train",
                endLocation: { name: "Saga-Arashiyama Station" },
              }),
            ],
          },
          {
            // A day LABEL, which the product has nowhere to store — see the
            // round-trip test for what that costs and why it is not a defect.
            label: "Bamboo and the west side",
            stops: [stop({ title: "Arashiyama", kind: "idea", tags: ["outdoors", "meal"] })],
          },
        ],
        backlog: [stop({ title: "Nishiki Market", notes: "If there is time." })],
        ...over,
      },
    ],
  }).trips[0]!;

describe("tripToBundle", () => {
  // **The milestone's thesis.** A field added to a trip and not to the export
  // makes this fail, in the diff that added it.
  it("round-trips a trip through the format without losing a field", () => {
    const original = source();
    const imported = tripToBundle(importTrip(original), {});
    const reimported = tripToBundle(importTrip(imported.trips[0]!, "22222222-2222-4222-8222-222222222222"), {});

    // Days in order, stops in order, every `BundleStop` field equal — against
    // the original with its one documented normalisation applied: an omitted
    // `kind` comes back as the explicit `"planned"` the format says it means.
    // Spelling it here rather than letting the export omit it too is a choice:
    // a round trip that is field-for-field identical is worth more than three
    // saved characters, and the cleverness would be what a later reader has to
    // re-derive.
    const planned = (s: Record<string, unknown>) => ({ kind: "planned", ...s });
    expect(imported.trips[0]!.days).toEqual(
      original.days.map((d) => ({ stops: d.stops.map(planned) })),
    );
    expect(imported.trips[0]!.backlog).toEqual(original.backlog.map(planned));
    expect(imported.trips[0]!.startDate).toBe("2027-03-14");

    // **And it is a fixed point**, which is the property the gate box actually
    // wants: what a person downloads, re-uploads and downloads again is byte
    // for byte the file they started with. Everything the format normalises has
    // already been normalised by the first pass.
    expect(reimported.trips[0]).toEqual(imported.trips[0]);
  });

  // **A hand-authored day LABEL does not survive, and that is not a defect.**
  // `BundleDay.label` is documented as not stored — Trip Planning has no day
  // title, and the field exists so a 14-day itinerary is reviewable as a file.
  // Worth a test rather than a comment, because "the export dropped something"
  // is exactly the report this would otherwise generate, and the answer is that
  // there is nowhere to drop it FROM.
  it("drops a day label, because the product has nowhere to keep one", () => {
    expect(source().days[1]!.label).toBe("Bamboo and the west side");
    const exported = tripToBundle(importTrip(source()), {});
    expect(exported.trips[0]!.days[1]).not.toHaveProperty("label");
    // The day itself, and its stops, are untouched by the loss.
    expect(exported.trips[0]!.days[1]!.stops.map((s) => s.title)).toEqual(["Arashiyama"]);
  });

  it("is a bundle the format itself accepts, so what downloads is what imports", () => {
    expect(() => ContentBundleV1.parse(tripToBundle(importTrip(source()), {}))).not.toThrow();
  });

  // **Question 1's scope line, asserted so that a later session finds the
  // decision rather than a gap.** These are absent by Mitchell's call, not by
  // oversight, and a test that expected them would be testing a scope this
  // milestone does not have.
  it("carries days and activities, and nothing else", () => {
    const detail = importTrip(source());
    const budgeted: TripDetail = {
      ...detail,
      currency: "JPY",
      budget: { amountMinor: 500_000, currency: "JPY" },
    };
    const exported = tripToBundle(budgeted, {});
    expect(exported.trips[0]).not.toHaveProperty("budget");
    expect(exported.trips[0]).not.toHaveProperty("currency");
    expect(exported.playbooks).toEqual([]);
    expect(exported.notebooks).toEqual([]);
    expect(exported.activities).toEqual([]);
    // A stop's own cost IS carried — it is a field of an activity, and `Money`
    // names its own currency, so it survives the trip-level one going away.
    expect(exported.trips[0]!.days[0]!.stops[0]!.cost).toEqual({ amountMinor: 0, currency: "JPY" });
  });

  // **Question 2, the dated half.** A stale export imports as a PAST trip, and
  // that is the correct answer rather than a defect to design around. A test
  // asserting an import lands in the future would be asserting the losing side
  // of a decision Mitchell took on 2026-09-18.
  it("emits a dated trip's real startDate, never startsInDays, however old the file is", () => {
    const exported = tripToBundle(importTrip(source()), {});
    expect(exported.trips[0]!.startDate).toBe("2027-03-14");
    expect(exported.trips[0]).not.toHaveProperty("startsInDays");

    const stale = { ...source(), startDate: "2019-01-02" };
    const landed = importTrip(stale);
    expect(landed.startDate).toBe("2019-01-02");
    expect(landed.days[0]!.date).toBe("2019-01-02");
  });

  // **Question 2, the dateless half.** The trip must not quietly acquire
  // today's date — which is exactly what it did before `tripStartDate` stopped
  // defaulting (see `schema.test.ts`, where that was seen red first).
  it("round-trips a dateless trip as dateless, with its days still in order", () => {
    const { startDate: _dropped, ...dateless } = source();
    const landed = importTrip(dateless as BundleTrip);
    expect(landed.startDate).toBeNull();
    expect(landed.days).toHaveLength(2);
    expect(landed.days.map((d) => d.date)).toEqual([null, null]);

    const exported = tripToBundle(landed, {});
    expect(exported.trips[0]).not.toHaveProperty("startDate");
    expect(exported.trips[0]).not.toHaveProperty("startsInDays");
    expect(exported.trips[0]!.days.map((d) => d.stops.map((s) => s.title))).toEqual([
      ["Fushimi Inari", "Lunch", "Train to Arashiyama"],
      ["Arashiyama"],
    ]);
  });

  // **The box that fails if somebody later wires `lint.ts` into the upload
  // path.** All three of these are ERRORS to the content linter and all three
  // are things the product creates by ordinary use, which is why the linter
  // does not run on uploads (question 3).
  it("round-trips trips the CONTENT rules would reject", () => {
    const empty = importTrip({ key: "e", name: "Empty", days: [], backlog: [] } as unknown as BundleTrip);
    expect(tripToBundle(empty, {}).trips[0]!.days).toEqual([]);

    const outOfOrder = {
      ...source(),
      days: [
        {
          stops: [
            stop({ title: "Late", timeWindow: { start: "16:00", end: "17:00" } }),
            stop({ title: "Early", timeWindow: { start: "09:00", end: "10:00" } }),
          ],
        },
      ],
      // A backlog item carrying a clock — an error to `lint.ts`, and what a
      // person gets by dragging a timed stop off its day.
      backlog: [stop({ title: "Parked but timed", timeWindow: { start: "08:00", end: "08:30" } })],
    };
    const exported = tripToBundle(importTrip(outOfOrder as BundleTrip), {});
    expect(exported.trips[0]!.days[0]!.stops.map((s) => s.title)).toEqual(["Late", "Early"]);
    expect(exported.trips[0]!.backlog[0]).toMatchObject({
      title: "Parked but timed",
      timeWindow: { start: "08:00", end: "08:30" },
    });
  });
});

describe("bundleKeyFor", () => {
  it("slugifies a name, keeping the letters under the accents", () => {
    expect(bundleKeyFor({ tripId: TRIP_ID, name: "Kyōto in March!" })).toBe("kyoto-in-march");
  });

  // A uuid is `^[0-9a-f-]+$`, so it always satisfies the key's own regex. A
  // name that slugifies to nothing is otherwise a 500 on an export whose only
  // problem is a non-latin name.
  it("falls back to the trip's uuid when a name slugifies to nothing", () => {
    expect(bundleKeyFor({ tripId: TRIP_ID, name: "京都" })).toBe(TRIP_ID);
    expect(bundleKeyFor({ tripId: TRIP_ID, name: "!!!" })).toBe(TRIP_ID);
  });

  it("produces a key the format accepts, for every name it is given", () => {
    for (const name of ["Kyōto in March!", "京都", "!!!", "a".repeat(400), "-leading-and-trailing-"]) {
      const key = bundleKeyFor({ tripId: TRIP_ID, name });
      expect(key).toMatch(/^[a-z0-9-]+$/);
      expect(key.length).toBeLessThanOrEqual(100);
    }
  });
});
