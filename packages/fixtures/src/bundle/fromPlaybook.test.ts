// A Playbook's round trip at the layer that owns it: **SavedDay → bundle →
// SavedDay**, and **bundle → stored sequence → bundle**, with no database.
// The endpoints' own claims (owner, visibility, version, fresh ids) are proven
// in `apps/web`'s int suite; field survival is proven once, here.
//
// Hand-written data rather than `@tc/factories`, for `fromTrip.test.ts`'s
// reason: that package depends on this one.

import { describe, expect, it } from "vitest";
import { SavedDay, type SavedStop } from "@tc/contracts";
import { parseBundle, type BundlePlaybook } from "./schema.ts";
import { PlaybookExportBundle, playbookToBundle, toBundleDays } from "./fromPlaybook.ts";
import { toSavedSequence } from "./toPlaybooks.ts";

/** Every field `SavedStop` has, set to something other than its zero value. */
const full = (title: string, dayIndex: number): SavedStop => ({
  title,
  timeWindow: { start: "09:00", end: "10:30" },
  location: {
    name: "Fushimi Inari",
    lat: 34.9671,
    lng: 135.7727,
    countryCode: "JP",
    city: "Kyoto",
  },
  notes: "Go early.",
  anchors: [{ kind: "dayOfWeek", days: ["mon", "tue"] }],
  // `transit`, because it is the one kind that may carry the travel leg below.
  kind: "transit",
  tags: ["ticketed", "outdoors"],
  cost: { amountMinor: 1200, currency: "JPY" },
  dayIndex,
  mode: "train",
  endLocation: { name: "Inari Station", lat: 34.9669, lng: 135.7699, countryCode: "JP", city: "Kyoto" },
});

/** The zero value of every optional field. */
const bare = (title: string, dayIndex: number): SavedStop => ({
  title,
  timeWindow: null,
  location: null,
  notes: null,
  anchors: [],
  kind: "planned",
  tags: [],
  cost: null,
  dayIndex,
  mode: null,
  endLocation: null,
});

/** Five days: 0 full, 1 empty (interior rest day), 2 two stops, 3 one, 4 empty (trailing). */
const playbook = SavedDay.parse({
  savedDayId: "22222222-2222-4222-8222-222222222222",
  ownerId: "google-author",
  name: "Kyōto slowly",
  stops: [full("Shrine", 0), bare("Market", 2), full("Temple", 2), bare("Onsen", 3)],
  dayCount: 5,
  cities: ["Kyoto"],
  visibility: "public",
  authorKind: "ai",
  adds: 7,
  sourceTripId: "33333333-3333-4333-8333-333333333333",
  sourceTripName: "Japan 2026",
  createdAt: "2026-09-01T00:00:00.000Z",
  version: 4,
  summary: "Five days, two of them rest.",
});

describe("playbookToBundle", () => {
  const bundle = playbookToBundle(playbook, { generatedAt: "2026-09-24T00:00:00.000Z" });
  const written = bundle.playbooks[0]!;

  it("writes one playbook and nothing else, and the file is a valid export", () => {
    expect(PlaybookExportBundle.safeParse(bundle).success).toBe(true);
    expect(bundle.trips).toEqual([]);
    expect(bundle.playbooks).toHaveLength(1);
  });

  it("keeps every day in order, the interior and trailing rest days included", () => {
    expect(written.days!.map((d) => d.stops.map((s) => s.title))).toEqual([
      ["Shrine"],
      [],
      ["Market", "Temple"],
      ["Onsen"],
      [],
    ]);
  });

  it("carries summary, visibility, version and origin, and the source trip by name only", () => {
    expect(written).toMatchObject({
      name: "Kyōto slowly",
      summary: "Five days, two of them rest.",
      visibility: "public",
      version: 4,
      origin: "ai",
      sourceTrip: { name: "Japan 2026" },
      addedBy: [],
    });
    expect(written.sourceTrip.id).toBeUndefined();
    expect(bundle.bundle.id).toBe("kyoto-slowly");
  });

  it("reads back, through the importer's own conversion, as the same stops and day count", () => {
    const reread = parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(toSavedSequence(reread.playbooks[0]!)).toEqual({
      stops: playbook.stops,
      dayCount: 5,
    });
  });
});

describe("toBundleDays is the inverse of toSavedSequence", () => {
  const authored = (days: BundlePlaybook["days"]): BundlePlaybook =>
    parseBundle({
      $schema: "travel-collab/content-bundle/v1",
      bundle: { id: "b", name: "B", origin: "human" },
      playbooks: [{ key: "p", name: "P", ownerId: "o", sourceTrip: { name: "T" }, days }],
    }).playbooks[0]!;

  it("bundle → stored → bundle keeps an empty middle day and an empty last day", () => {
    const days = [
      { stops: [{ title: "A", kind: "planned" as const }] },
      { stops: [] },
      { stops: [{ title: "B", kind: "pending" as const, notes: "n" }] },
      { stops: [] },
    ];
    const stored = toSavedSequence(authored(days));
    expect(stored.dayCount).toBe(4);
    expect(stored.stops.map((s) => s.dayIndex)).toEqual([0, 2]);
    expect(toBundleDays(stored)).toEqual(days);
  });

  it("never renders a stop past dayCount out of existence", () => {
    // A DTO that did not cross the read boundary can understate its count.
    expect(toBundleDays({ stops: [bare("Late", 2)], dayCount: 1 })).toHaveLength(3);
  });
});
