import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { JAPAN_SAVED_DAYS, parseBundle, playbookIdFor, resolvePlaybook, STARTER_SAVED_DAYS } from "@tc/fixtures";
import {
  buildLandingDemo,
  buildLandingFeatures,
  buildLandingSea,
  CARDS_PATH,
  CREW,
  demoPersonasOf,
  FEATURES_PATH,
  SEA_PATH,
  serializeLandingDemo,
  snapshotPath,
} from "./landing-demo";
import { personasOf } from "@/components/pages/people";
import { ratingLine } from "@/components/playbooks/DiscoverCard";
import { demoTripBySlug } from "@/lib/demoTrip";
import { dayPath } from "@/lib/playbookUrls";
import { demoTripCards, demoTripMembers } from "@/server/demoTrip";

// `pnpm landing:verify`, inside `pnpm test` — where the fixture's own check
// (`seed:verify`) and the content lint already run in CI. The front door draws
// `landingDemo*.generated.json`, and `/demo` its cards; a fixture, bundle or
// resolver change that moves what either would draw fails here until the files
// are regenerated (`pnpm --filter web landing:generate`).
//
// One per demo (M42 D2), and the demos are read off `content/trips/` here
// rather than off `DEMO_TRIPS`, so a bundle added there cannot be left without
// a snapshot or a card.
const TRIPS_DIR = new URL("../../../content/trips/", import.meta.url);
const SLUGS = [
  "japan",
  ...readdirSync(TRIPS_DIR)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => (JSON.parse(readFileSync(new URL(file, TRIPS_DIR), "utf8")) as { trips: { key: string }[] }).trips)
    .map((trip) => trip.key),
];

// The sea (M51) is held the same way: the generator's output, byte for byte,
// with no calendar date in it.
const SNAPSHOTS = [
  ...SLUGS.map((slug) => ({ name: slug, path: snapshotPath(slug), fresh: () => buildLandingDemo(slug) })),
  { name: "sea", path: SEA_PATH, fresh: buildLandingSea },
];

describe.each(SNAPSHOTS)("the landing's $name snapshot", ({ path, fresh: build }) => {
  it("is exactly what the generator makes from the current trip", () => {
    expect(existsSync(path), `${path} is not committed`).toBe(true);
    const committed = readFileSync(path, "utf8");
    const fresh = serializeLandingDemo(build());
    // Parsed first, so a failure names the field that moved rather than two
    // truncated strings; then byte for byte, as `landing:verify` compares.
    expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
    expect(committed).toBe(fresh);
  });

  // The spec's other promise about the file (§3.2): no calendar dates, because
  // `/demo/<slug>` moves its dates and a frozen one would go stale.
  it("carries no calendar date", () => {
    expect(readFileSync(path, "utf8")).not.toMatch(/\d{4}-\d{2}-\d{2}|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
  });
});

// The landing's card shows a cover photo, which is a stored `TripCover` and
// Unsplash's CDN, never Unsplash's API: generating or verifying the snapshot
// asks nobody anything, so `landing:verify` runs offline in CI.
describe("the landing's snapshot generator", () => {
  it("makes no network request, to Unsplash or anywhere", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    buildLandingFeatures();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// M42 part 9: the Playbooks block's card is a bundled playbook and the
// Notebook block's page resolves widgets against Japan, so an edit to either
// moves what the landing draws, and fails here until it is regenerated.
describe("the landing's feature blocks", () => {
  it("are exactly what the generator makes from the current playbook and trip", () => {
    expect(existsSync(FEATURES_PATH), `${FEATURES_PATH} is not committed`).toBe(true);
    const committed = readFileSync(FEATURES_PATH, "utf8");
    const fresh = serializeLandingDemo(buildLandingFeatures());
    expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
    expect(committed).toBe(fresh);
  });
});

// The script restates the board's `personasOf`, which it cannot load. Held to
// the original here, so a naming rule changed there cannot leave the notebook
// page's people on the old one while `landing:verify` compares the script
// with itself. `colorShifted` is the board's alone: a widget persona has none.
describe("the landing's people", () => {
  it("are the board's personas for the demo trip", () => {
    const { tripId } = demoTripBySlug("japan")!;
    const board = Object.fromEntries(
      Object.entries(personasOf(demoTripMembers(tripId))).map(([userId, { colorShifted: _shifted, ...persona }]) => [userId, persona]),
    );
    expect(demoPersonasOf(tripId)).toEqual(board);
  });
});

describe("the /demo picker's cards", () => {
  it("are exactly what the generator makes, one for every demo", () => {
    const committed = readFileSync(CARDS_PATH, "utf8");
    expect(JSON.parse(committed)).toEqual(demoTripCards());
    expect(committed).toBe(serializeLandingDemo(demoTripCards()));
    expect((JSON.parse(committed) as { slug: string }[]).map((card) => card.slug).sort()).toEqual([...SLUGS].sort());
  });
});

// M51 part 1: the sea is every public day in the library, each a card Discover
// would draw, at a size, behind a link to its own day page.
const PLAYBOOKS_DIR = new URL("../../../content/playbooks/", import.meta.url);
const BUNDLES = readdirSync(PLAYBOOKS_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => parseBundle(JSON.parse(readFileSync(new URL(file, PLAYBOOKS_DIR), "utf8"))));
// Everything the content import reads, which is every bundle under `content/`.
const CONTENT_DIR = new URL("../../../content/", import.meta.url);
const CONTENT = readdirSync(CONTENT_DIR, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".json") && !file.split("/").at(-1)!.startsWith("."))
  .map((file) => parseBundle(JSON.parse(readFileSync(new URL(file, CONTENT_DIR), "utf8"))));
const SIZES = ["1x1", "2x1", "1x2", "2x2", "3x1", "1x3"];

describe("the landing's sea", () => {
  const sea = buildLandingSea();

  it("holds every public library day, once", () => {
    const published = BUNDLES.flatMap((b) => b.playbooks.filter((p) => p.visibility === "public").map((p) => playbookIdFor(b.bundle.id, p.key)));
    expect(sea.cells.map((cell) => cell.day.savedDayId).sort()).toEqual([...published].sort());
    expect(sea.cells.every((cell) => cell.day.visibility === "public")).toBe(true);
  });

  // Mitchell, 2026-10-20: whatever links somewhere links to a real day in the
  // database of the deployment that serves it. A content bundle's day is one
  // wherever `content/` is imported: its id derives from (bundle, key), and
  // `db:reseed` imports it locally, `import-content-production.yml` in
  // production. Previews import none until M51 part 7. A dev fixture day exists
  // only where dev-login seeded it, never in production.
  it("links only days the content import writes, at the path it serves them on", () => {
    const imported = new Map(
      CONTENT.flatMap((b) =>
        b.playbooks.map((p) => {
          const day = resolvePlaybook(b.bundle.id, p, b.bundle.origin);
          return [day.savedDayId, dayPath(day)] as const;
        }),
      ),
    );
    const fixtureDays = new Set([...JAPAN_SAVED_DAYS, ...STARTER_SAVED_DAYS].map((day) => day.savedDayId));
    const linked = [...sea.cells, ...sea.japan].filter((cell) => cell.href !== null);
    expect(linked.length).toBeGreaterThan(0);
    const wrong = linked.filter((cell) => fixtureDays.has(cell.day.savedDayId) || cell.href !== imported.get(cell.day.savedDayId));
    expect(wrong.map((cell) => cell.href)).toEqual([]);
  });

  it("gives each cell a grid size", () => {
    expect(sea.cells.filter((cell) => !SIZES.includes(cell.size))).toEqual([]);
    expect(new Set(sea.cells.map((cell) => cell.size)).size).toBe(SIZES.length);
  });

  // Decision 9: sample ratings in the card's own format, about one in nine
  // with none, so the sea does not read as a wall of identical claims.
  it("gives about one card in nine no reviews, and the rest a rating", () => {
    const lines = sea.cells.map((cell) => ratingLine(cell.day));
    expect(lines.filter((line) => line !== null && !/^[1-5]\.\d · \d+ reviews$/.test(line))).toEqual([]);
    const unrated = lines.filter((line) => line === null).length / lines.length;
    expect(unrated).toBeGreaterThan(1 / 14);
    expect(unrated).toBeLessThan(1 / 6);
  });

  it("draws no price, no tag link and no date", () => {
    for (const { day } of sea.cells) {
      expect(day).toMatchObject({ totalCost: null, namedTags: [] });
      expect(day).not.toHaveProperty("createdAt");
      expect(day).not.toHaveProperty("publishedAt");
      expect(day).not.toHaveProperty("sourceTripName");
    }
  });

  it("holds the demo seed's public Japan days around the notebook", () => {
    expect(sea.japan.map((cell) => cell.day.savedDayId)).toEqual(JAPAN_SAVED_DAYS.filter((d) => d.visibility === "public").map((d) => d.savedDayId));
    expect(sea.japan.every((cell) => SIZES.includes(cell.size))).toBe(true);
  });
});

// The crew moment (decision 10): a Greek trip of three library days, Paros,
// Naxos and Santorini, that took Elena's Naxos day as its Day 2, planned by
// four people.
describe("the landing's crew trip", () => {
  const { crew } = buildLandingFeatures();
  const greek = BUNDLES.find((b) => b.bundle.id === "greek-islands")!;
  const naxos = greek.playbooks.find((p) => p.key === "naxos-zas-marble-villages-and-plaka")!;

  it("is three days, with Elena's Naxos day as its Day 2", () => {
    expect(naxos.ownerId).toBe("dev-elena");
    expect(Object.keys(crew.accents)).toHaveLength(3);
    expect(crew.river.ordinal).toBe(2);
    expect(crew.river.activityIds.map((id) => crew.river.activities[id]!.title)).toEqual(naxos.stops!.map((stop) => stop.title));
    expect(crew.borrowed).toEqual({ savedDayId: playbookIdFor("greek-islands", naxos.key), href: expect.stringMatching(/^\/playbooks\/day\/naxos-/) });
  });

  it("names every one of the crew on some stop of that day", () => {
    const named = Object.values(crew.river.activities).flatMap((a) => [a.bookedBy, ...a.participants]);
    expect(Object.keys(crew.personas).sort()).toEqual([...CREW].sort());
    for (const person of CREW) expect(named).toContain(person);
  });

  // "Booked by Tomas" on filling a water bottle is a fake-looking claim on the
  // page whose job is to look real: a booking is a table, a ticket or a tour.
  it("credits a booking only on a stop somebody books", () => {
    const booked = Object.values(crew.river.activities).filter((a) => a.bookedBy !== null);
    expect(booked.length).toBeGreaterThan(0);
    const unbookable = booked.filter((a) => a.kind !== "planned" || !a.tags.some((tag) => ["meal", "ticketed", "tour"].includes(tag)));
    expect(unbookable.map((a) => `${a.bookedBy}: ${a.title}`)).toEqual([]);
  });
});

// KI-2026-10-20-a: the Railay viewpoint sat 4.2 km north, on the mainland, and
// the trip copied it onto a dinner stop. Every pinned stop either file places
// in Railay sits on the peninsula, Phra Nang to the walking street, which a
// pin a kilometre out does not.
describe("the Railay stops", () => {
  // Flagged by the KI as about 1 km north of the walking street, and left for
  // want of a source to correct it from.
  const MAMAS_CHICKEN = "Mama's Chicken, East Railay walking street";
  const stopsIn = (file: URL) => {
    const bundle = parseBundle(JSON.parse(readFileSync(file, "utf8")));
    return [
      ...bundle.playbooks.flatMap((p) => p.stops ?? p.days!.flatMap((d) => d.stops)),
      ...bundle.trips.flatMap((t) => [...t.days.flatMap((d) => d.stops), ...t.backlog]),
    ].filter((stop) => stop.location?.area === "Railay" && stop.location.lat !== undefined);
  };
  it.each(["playbooks/thailand-beaches.json", "trips/thailand-andaman.json"])("sit on the peninsula in %s", (file) => {
    const stops = stopsIn(new URL(`../../../content/${file}`, import.meta.url));
    expect(stops.length).toBeGreaterThan(0);
    const off = stops.filter(
      ({ location }) => location!.name !== MAMAS_CHICKEN && !(location!.lat! > 8.0035 && location!.lat! < 8.016 && location!.lng! > 98.835 && location!.lng! < 98.846),
    );
    expect(off.map((stop) => `${stop.title} @ ${stop.location!.lat}, ${stop.location!.lng}`)).toEqual([]);
  });
});
