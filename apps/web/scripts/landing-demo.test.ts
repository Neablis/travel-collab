import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { JAPAN_SAVED_DAYS, parseBundle, playbookIdFor } from "@tc/fixtures";
import { describeByTags } from "@tc/domain";
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
import { bundleFiles, CONTENT_DIR, contentDays } from "./lib/content-bundles";
import { personasOf } from "@/components/pages/people";
import { ratingLine } from "@/components/playbooks/DiscoverCard";
import { demoTripBySlug } from "@/lib/demoTrip";
import { LANDING_SEA, SEA_ACCENTS, SEA_DAYS, type SeaDayCell } from "@/lib/landingSea";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { countrySlug, dayPath, MIN_INDEXED_PLACE_DAYS, slugify } from "@/lib/playbookUrls";
import { savedDayCities } from "@/server/savedDayCities";
import { savedDayCountries } from "@/server/savedDayCountries";
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

// A month only with a day or a year beside it: the sea's stop titles name
// places like "Sierra Mar", which a bare month word would call a date.
const MONTH = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const CALENDAR_DATE = new RegExp(`\\d{4}-\\d{2}-\\d{2}|\\b${MONTH}\\.? (\\d{1,2}|\\d{4})\\b|\\b\\d{1,2} ${MONTH}\\b`);

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
    expect(readFileSync(path, "utf8")).not.toMatch(CALENDAR_DATE);
  });
});

describe("the calendar-date guard", () => {
  it.each(["2026-10-21", "Oct 21", "Oct. 21", "21 Oct", "Tue 21 Oct", "Oct 2026", "Mar. 2027"])("catches %s", (text) => {
    expect(text).toMatch(CALENDAR_DATE);
  });
  it.each(["Sierra Mar", "Dinner at Sierra Mar", "Sierra Mar, Big Sur"])("lets the place name %s through", (text) => {
    expect(text).not.toMatch(CALENDAR_DATE);
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
const SIZES = ["1x1", "2x1", "1x2", "2x2", "3x1", "1x3"];

describe("the landing's sea", () => {
  const sea = buildLandingSea();
  const days = sea.cells.filter((cell): cell is SeaDayCell => "day" in cell);

  it("holds every public library day, once", () => {
    const published = BUNDLES.flatMap((b) => b.playbooks.filter((p) => p.visibility === "public").map((p) => playbookIdFor(b.bundle.id, p.key)));
    expect(days.map((cell) => cell.day.savedDayId).sort()).toEqual([...published].sort());
    expect(days.every((cell) => cell.day.visibility === "public")).toBe(true);
  });

  it("gives each cell a grid size", () => {
    expect(days.filter((cell) => !SIZES.includes(cell.size))).toEqual([]);
    expect(new Set(days.map((cell) => cell.size)).size).toBe(SIZES.length);
  });

  // Decision 9: sample ratings in the card's own format, about one in nine
  // with none, so the sea does not read as a wall of identical claims.
  it("gives about one card in nine no reviews, and the rest a rating", () => {
    const lines = days.map((cell) => ratingLine(cell.day));
    expect(lines.filter((line) => line !== null && !/^[1-5]\.\d · \d+ reviews$/.test(line))).toEqual([]);
    const unrated = lines.filter((line) => line === null).length / lines.length;
    expect(unrated).toBeGreaterThan(1 / 14);
    expect(unrated).toBeLessThan(1 / 6);
  });

  it("draws no price, no tag link and no date", () => {
    for (const { day } of days) {
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

// The links stay real (M51 gate), and Mitchell, 2026-10-20: whatever links
// somewhere links to a real day in the database of the deployment that serves
// it. Every href the landing draws from its snapshot must open a public day the
// content import writes, which every preview build and
// `import-content-production.yml` import from `content/`. Asked of the
// importers' own reader and id derivation, not a model of them. A Japan cell is
// a demo-seed day, which no deployment's library holds, so it carries no link.
describe("the sea's links, as the landing draws them", () => {
  const written = new Map(
    bundleFiles(CONTENT_DIR)
      .flatMap((file) => contentDays(parseBundle(JSON.parse(readFileSync(file, "utf8")))))
      .map((day) => [day.savedDayId, day]),
  );

  it("each open a public day the content import writes, at its canonical path", () => {
    expect(SEA_DAYS.length).toBeGreaterThan(0);
    const broken = SEA_DAYS.filter((cell) => {
      const day = written.get(cell.day.savedDayId);
      return day === undefined || day.visibility !== "public" || cell.href !== dayPath(day);
    });
    expect(broken.map((cell) => cell.href)).toEqual([]);
  });

  it("give no Japan cell a link", () => {
    expect(LANDING_SEA.japan.length).toBeGreaterThan(0);
    expect(LANDING_SEA.japan.filter((cell) => cell.href !== null)).toEqual([]);
  });

  // Mitchell's third walk of PR 510: accents "link to those pages if you
  // click there", and Mitchell, 2026-10-20, whatever links somewhere links to
  // something real. Each accent's page lists at least `MIN_INDEXED_PLACE_DAYS`
  // public days the content import writes, counted by the routes' own slugs:
  // a city or country over the day's places, a tag over the days whose
  // description names it (ADR-070 §4).
  it("put each accent on a country, city or tag page the content import fills with days", () => {
    const pages = new Map<string, Set<string>>();
    const add = (href: string | null, id: string) => {
      if (href !== null) pages.set(href, (pages.get(href) ?? new Set()).add(id));
    };
    for (const day of [...written.values()].filter((d) => d.visibility === "public")) {
      for (const city of savedDayCities(day.stops)) add(`/playbooks/city/${slugify(city)}`, day.savedDayId);
      for (const code of savedDayCountries(day.stops)) {
        const slug = countrySlug(code);
        add(slug === null ? null : `/playbooks/country/${slug}`, day.savedDayId);
      }
      for (const tag of describeByTags(day.stops)?.named ?? []) add(`/playbooks/tag/${tag}`, day.savedDayId);
    }
    expect(SEA_ACCENTS.length).toBeGreaterThan(0);
    const thin = SEA_ACCENTS.filter(
      (accent) => !accent.href.startsWith(`/playbooks/${accent.kind}/`) || (pages.get(accent.href)?.size ?? 0) < MIN_INDEXED_PLACE_DAYS,
    );
    expect(thin.map((accent) => accent.href)).toEqual([]);
    expect(new Set(SEA_ACCENTS.map((accent) => accent.kind))).toEqual(new Set(["country", "city", "tag"]));
  });
});

// The find moment's banner is a day named by its key, not ranked (Mitchell's
// fourth walk of PR 510: *"Let the rule go"*). It is a day of the sea, and it
// draws the rating its own cell in the sea draws.
describe("the find moment's banner", () => {
  it("is a day of the sea, rated as its cell is", () => {
    const { shelf } = LANDING_FEATURES;
    const own = SEA_DAYS.find((cell) => cell.day.savedDayId === shelf.savedDayId);
    expect(own?.day.name).toBe(shelf.name);
    expect({ rating: own?.day.rating, reviews: own?.day.reviewCount }).toEqual({ rating: shelf.rating, reviews: shelf.reviewCount });
  });

  // Mitchell, 2026-10-21: *"use day 2 for the banner"* first, superseded
  // by his preview feedback the same evening: day 1, whose four stops fit
  // the moment where day 2's six did not. The banner previews Day 1 now.
  it("previews Rome's day 1, and links to the Rome playbook", () => {
    const rome = "3-days-in-rome-emperors-gladiators-the-layers-beneath";
    const playbook = BUNDLES.find((b) => b.bundle.id === rome)!.playbooks.find((p) => p.key === rome)!;
    const { shelf } = LANDING_FEATURES;
    expect(shelf.savedDayId).toBe(playbookIdFor(rome, rome));
    expect(shelf.preview.map((stop) => stop.title)).toEqual(playbook.days![0]!.stops.map((stop) => stop.title));
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
