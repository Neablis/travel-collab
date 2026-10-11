import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLandingDemo, CARDS_PATH, serializeLandingDemo, snapshotPath } from "./landing-demo";
import { demoTripCards } from "@/server/demoTrip";

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

describe.each(SLUGS)("the landing's %s snapshot", (slug) => {
  it("is exactly what the generator makes from the current trip", () => {
    expect(existsSync(snapshotPath(slug)), `${snapshotPath(slug)} is not committed`).toBe(true);
    const committed = readFileSync(snapshotPath(slug), "utf8");
    const fresh = serializeLandingDemo(buildLandingDemo(slug));
    // Parsed first, so a failure names the field that moved rather than two
    // truncated strings; then byte for byte, as `landing:verify` compares.
    expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
    expect(committed).toBe(fresh);
  });

  // The spec's other promise about the file (§3.2): no calendar dates, because
  // `/demo/<slug>` moves its dates and a frozen one would go stale.
  it("carries no calendar date", () => {
    expect(readFileSync(snapshotPath(slug), "utf8")).not.toMatch(/\d{4}-\d{2}-\d{2}|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
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
