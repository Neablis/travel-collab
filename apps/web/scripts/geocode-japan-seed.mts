// One-off, offline geocoding pass for the Japan demo seed
// (.design-sync/handoff/data/japan-trip-seed.json). Writes
// src/lib/japanTripSeedCoordinates.json, the overlay `importJapanTripSeed`
// (src/lib/japanTripImporter.ts) reads to attach lat/lng — the seed itself
// carries none, which is why MapLens's 72 demo stops render zero pins today.
//
// Run from apps/web:
//   node --env-file=.env.local scripts/geocode-japan-seed.mts
//
// Offline and committed, not looked up at reset time: 70-odd lookups at
// LocationIQ's real per-second cap would add over a minute to every demo
// reset (see reset-demo-data/route.ts's own 30s ceiling), would 429 under any
// concurrency, and would make the demo trip's pins non-deterministic run to
// run. This script is the one-time (rerun-when-the-seed-changes) source of
// that overlay; nothing at request time calls LocationIQ for this data.
//
// A plain `.mjs` file, not `.ts`, dependency-free ESM, matching db-reset.mjs's
// convention (see its own comment) rather than db-seed.ts's — this one
// reaches into src/server/**, which db-seed.ts never does, by importing the
// real implementation files directly with their `.ts` extension. Node's
// unflagged type-stripping (Node >= 22.18, this repo's floor) loads that
// fine at runtime; `tsc --noEmit` would reject an explicit `.ts` import
// specifier (TS5097) if this script were itself a `.ts` file under
// tsconfig's `include`, and `eslint src` never sees `scripts/` at all — a
// `.mjs` entry point sidesteps both without touching either config.
//
// Reuses `createLocationIQGeocoder` (the vendor adapter behind the
// `Geocoder` seam, ADR-007) directly rather than through `getGeocoder()`
// (src/server/geocoding/index.ts): that wrapper pulls in `../config`, whose
// module-load-time `DATABASE_URL` check has nothing to do with geocoding and
// would make this script fail without a DB configured. Reading
// LOCATIONIQ_API_KEY here is the same one env var `serverConfig` itself
// reads, just without the unrelated config module in between. `locationiq.ts`
// and the `Geocoder`/`GeocodeOptions` interfaces are untouched, per the task.
//
// Method (KI-15's lesson — docs/known-issues.md — reproduced at this call
// site, not by loosening the shared seam):
//   1. Query = "<place>, <area>, <city>, Japan" for a scheduled stop — the
//      seed's own fields, the same shape japanTripImporter.ts's
//      `locationName()` builds for the activity's display name (exported
//      from there so this script can't drift from what actually gets
//      stored).
//   2. A TIGHT, hand-picked bounding box per city the trip visits (below) —
//      not a soft, whole-Japan bias. Narrow enough that Narita, Chiba (a
//      real LocationIQ top result for "HND Terminal 3, Tokyo, Japan") falls
//      outside the Tokyo box.
//   3. Ask for up to 5 candidates and accept the first one that actually
//      falls inside the box (`withinBox`, src/server/ai/geocodeRegion.ts) —
//      never the vendor's own `bounded=1`, which is a request-level cutoff
//      LocationIQ can refuse outright: a Tokyo-bounded `bounded=1` search for
//      "HND Terminal 3, Ōta, Tokyo, Japan" returns zero results (measured
//      directly, see the run report) even though the vendor does have the
//      right answer for a slightly different query. `viewbox` alone is only
//      a ranking bias (KI-15) — this script supplies the missing acceptance
//      test itself, exactly what `GeocodeOptions.viewbox`'s own comment says
//      the caller is responsible for.
//   4. Then a NAME-IDENTITY check on the candidates that survived step 3
//      (`placeNameVerdict`, src/server/ai/geocodeNameMatch.ts — KI-39). The
//      box only rejects a wrong-CITY match; it structurally cannot reject a
//      wrong-VENUE match sitting inside the right city, and on the first run
//      eleven of the 54 accepted results were exactly that ("Kegon Falls" ->
//      Urami Falls, "Zentis Osaka" -> Hotels Inn Osaka KitaUmeda,
//      "Shin-Osaka Station" -> Shinagawa Station, "Afuri" -> WITH HARAJUKU,
//      …). Every distinctive token of the queried place — its own name minus
//      category nouns ("Falls", "Station", "Hotel") and minus the geography
//      already in the query — must appear in the candidate's own name.
//      A candidate whose name comes back purely in local script (明治神宮 for
//      "Meiji Jingū") has nothing romanised to compare and is reported as
//      name-unverified rather than failed: see that module's header for why
//      that is neither "match" nor "mismatch". A name-verified candidate is
//      preferred over an unverified one even if the vendor ranked it lower.
//   5. No candidate inside the box, or none whose name matches -> unresolved.
//      No city-centroid fallback, no retry with a looser box, no unbounded
//      query. A missing pin is reported and left missing; nothing here ever
//      guesses one.
//
// `unscheduled[]` items (the trip's backlog) carry no city of their own
// (see DROPPED_SEED_FIELDS / UnscheduledSeed in japanTripImporter.ts), so
// there's no single per-city box to apply step 2 with. Their query drops the
// city segment ("<place>, <area>, Japan", matching
// `unscheduledLocationName()`) and the search itself is unbounded; the
// acceptance test widens instead to "inside ANY of the six city boxes below"
// — still a hard bound, just not pinned to one city ahead of time. Only 4 of
// the seed's 72 stops take this path, and each of the four place names
// (Ghibli Museum, Kōenji, Nishiki Market, Kiyomizu-dera) is distinctive
// enough in Japan that an unbounded top-5 search finding its real match is
// not the same risk "HND Terminal 3" was — the box test still guards it, and
// step 4's name check now guards it too (with only the area, not a city, as
// the geography it must discount).
//
// Duplicate stops (the same place/area queried under the same city — e.g.
// HND Terminal 3 appears on both Day 1 and Day 14, Gora Kadan twice on Day
// 6) are deduped to one LocationIQ call, then the same result is written
// under every id that asked for it. Same place, same query, same answer —
// this is the dedupe `geocodeEnrichment.ts` already does for the same
// reason, not a shortcut invented here.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLocationIQGeocoder } from "../src/server/geocoding/locationiq.ts";
import { withinBox, type BoundingBox, type LatLng } from "../src/server/ai/geocodeRegion.ts";
import { placeNameVerdict, type NameVerdict } from "../src/server/ai/geocodeNameMatch.ts";
import { mapRateLimited } from "../src/server/ai/rateLimit.ts";
import { parseTripSeed, locationName, unscheduledLocationName } from "../src/lib/japanTripImporter.ts";

const SEED_PATH = fileURLToPath(new URL("../../../.design-sync/handoff/data/japan-trip-seed.json", import.meta.url));
const OUTPUT_PATH = fileURLToPath(new URL("../src/lib/japanTripSeedCoordinates.json", import.meta.url));

// Tight boxes around the six cities the trip actually visits (trip.cities in
// the seed) — hand-picked from the real-world span of this trip's own stops
// (cross-checked against scripts/db-seed.ts's independently hand-entered
// Japan coordinates: 66 of that trip's 72 real points fall inside these
// boxes; the other 6 are transit stops whose day is labeled with the
// destination city but whose stop is physically in the departure city —
// e.g. Day 4 is labeled "Nikkō" but its first stop, Tobu Asakusa Station, is
// in Tokyo. Those are expected misses under this method, not a box-sizing
// bug: the seed gives no per-stop city, only a per-day one).
//
// [minLat, maxLat, minLng, maxLng]. The Tokyo box's east edge (139.95) is
// the one load-bearing number here — Narita, Chiba sits at ~140.38, so
// anything past ~140.1 already excludes it with room to spare.
const CITY_VIEWBOXES: Record<string, BoundingBox> = {
  Tokyo: { minLat: 35.5, maxLat: 35.85, minLng: 139.3, maxLng: 139.95 },
  Nikkō: { minLat: 36.6, maxLat: 36.9, minLng: 139.35, maxLng: 139.75 },
  Hakone: { minLat: 35.15, maxLat: 35.3, minLng: 138.9, maxLng: 139.15 },
  Kyoto: { minLat: 34.85, maxLat: 35.1, minLng: 135.6, maxLng: 135.85 },
  Osaka: { minLat: 34.55, maxLat: 34.75, minLng: 135.35, maxLng: 135.6 },
  Naoshima: { minLat: 34.4, maxLat: 34.52, minLng: 133.9, maxLng: 134.05 },
};
const ALL_CITY_BOXES = Object.values(CITY_VIEWBOXES);

const REQUESTS_PER_SECOND = 1; // "roughly 1 request/second" (task); LocationIQ's real cap is 2/sec.
const MIN_INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;

interface Job {
  key: string;
  query: string;
  place: string; // the venue alone — what the name-identity check must find
  context: string[]; // area/city/country: real, but useless for telling two venues apart
  viewbox: BoundingBox | undefined; // biases the search; undefined = unbounded (unscheduled items only)
  acceptBoxes: readonly BoundingBox[]; // the hard bound this script itself enforces
  ids: string[];
}

interface Resolved {
  ids: string[];
  query: string;
  lat: number;
  lng: number;
  canonicalName: string;
  // "not-comparable" = accepted on the box plus a local-script name nothing
  // here can read. Reported at the end so a human pass knows which pins were
  // never name-verified (KI-39).
  nameVerdict: Exclude<NameVerdict, "mismatch">;
}

interface Unresolved {
  ids: string[];
  query: string;
  reason: "no-candidate-in-box" | "name-mismatch" | "lookup-failed";
  detail?: string;
  // Every candidate LocationIQ actually returned, so "why did this miss"
  // is answerable from the report without re-running the script.
  candidates?: { lat: number; lng: number; canonicalName: string }[];
}

function addJob(
  jobs: Map<string, Job>,
  key: string,
  job: Omit<Job, "key" | "ids">,
  id: string,
): void {
  const existing = jobs.get(key);
  if (existing) {
    existing.ids.push(id);
    return;
  }
  jobs.set(key, { key, ...job, ids: [id] });
}

function buildJobs(seed: ReturnType<typeof parseTripSeed>): Job[] {
  const jobs = new Map<string, Job>();

  for (const day of seed.days) {
    const box = CITY_VIEWBOXES[day.city];
    if (!box) throw new Error(`no viewbox configured for city "${day.city}" (day ${day.index})`);
    for (const stop of day.stops) {
      const query = locationName(stop.place, stop.area, day.city);
      const job = { query, place: stop.place, context: [stop.area, day.city, "Japan"], viewbox: box, acceptBoxes: [box] };
      addJob(jobs, `stop|${day.city}|${stop.place}|${stop.area}`, job, stop.id);
    }
  }

  for (const item of seed.unscheduled) {
    const query = unscheduledLocationName(item.place, item.area);
    const job = { query, place: item.place, context: [item.area, "Japan"], viewbox: undefined, acceptBoxes: ALL_CITY_BOXES };
    addJob(jobs, `unscheduled|${item.place}|${item.area}`, job, item.id);
  }

  return [...jobs.values()];
}

async function resolveJob(
  geocoder: ReturnType<typeof createLocationIQGeocoder>,
  job: Job,
): Promise<Resolved | Unresolved> {
  let candidates;
  try {
    candidates = await geocoder.forward(job.query, { limit: 5, ...(job.viewbox ? { viewbox: job.viewbox } : {}) });
  } catch (err) {
    // Never counted as "no coordinates" — a vendor error/rate-limit is a
    // distinct, reported outcome (task constraint #5 / KI-15's original sin).
    return { ids: job.ids, query: job.query, reason: "lookup-failed", detail: String(err) };
  }

  const report = (c: { lat: number; lng: number; canonicalName: string }) => ({ lat: c.lat, lng: c.lng, canonicalName: c.canonicalName });

  const inBox = candidates.filter((c) => job.acceptBoxes.some((box) => withinBox(box, { lat: c.lat, lng: c.lng } satisfies LatLng)));
  if (inBox.length === 0) {
    return { ids: job.ids, query: job.query, reason: "no-candidate-in-box", candidates: candidates.map(report) };
  }

  // Name identity, after the box (KI-39). A verified name beats the vendor's
  // ranking: an unverifiable candidate is only taken when no candidate in the
  // box actually matches the queried venue by name.
  const judged = inBox.map((c) => ({ candidate: c, verdict: placeNameVerdict(job.place, c.canonicalName, job.context) }));
  const verified = judged.find((j) => j.verdict === "match");
  const match = verified ?? judged.find((j) => j.verdict === "not-comparable");
  if (!match) {
    return { ids: job.ids, query: job.query, reason: "name-mismatch", candidates: inBox.map(report) };
  }
  const nameVerdict: Exclude<NameVerdict, "mismatch"> = verified ? "match" : "not-comparable";
  return {
    ids: job.ids,
    query: job.query,
    lat: match.candidate.lat,
    lng: match.candidate.lng,
    canonicalName: match.candidate.canonicalName,
    nameVerdict,
  };
}

function isResolved(r: Resolved | Unresolved): r is Resolved {
  return !("reason" in r);
}

async function main(): Promise<void> {
  const apiKey = process.env.LOCATIONIQ_API_KEY;
  if (!apiKey) throw new Error("LOCATIONIQ_API_KEY is not set (run with node --env-file=.env.local from apps/web)");
  const geocoder = createLocationIQGeocoder(apiKey);

  const seed = parseTripSeed(JSON.parse(readFileSync(SEED_PATH, "utf-8")));
  const totalStops = seed.days.reduce((n, d) => n + d.stops.length, 0) + seed.unscheduled.length;
  const jobs = buildJobs(seed);

  console.log(`${totalStops} stops (${seed.days.length} days + ${seed.unscheduled.length} unscheduled), ${jobs.length} unique lookups at ~${REQUESTS_PER_SECOND} req/sec.`);

  const results = await mapRateLimited(jobs, MIN_INTERVAL_MS, (job) => resolveJob(geocoder, job));

  const resolved = results.filter(isResolved);
  const unresolved = results.filter((r): r is Unresolved => !isResolved(r));
  const failed = unresolved.filter((r) => r.reason === "lookup-failed");
  const noMatch = unresolved.filter((r) => r.reason === "no-candidate-in-box");
  const nameMismatch = unresolved.filter((r) => r.reason === "name-mismatch");
  const unverified = resolved.filter((r) => r.nameVerdict === "not-comparable");

  const coordinates: Record<string, { lat: number; lng: number; canonicalName: string }> = {};
  for (const r of resolved) {
    for (const id of r.ids) coordinates[id] = { lat: r.lat, lng: r.lng, canonicalName: r.canonicalName };
  }

  const resolvedStopCount = resolved.reduce((n, r) => n + r.ids.length, 0);
  const unresolvedStopCount = totalStops - resolvedStopCount;

  const overlay = {
    $schema: "japan-trip-seed-coordinates/v1",
    generatedBy: "apps/web/scripts/geocode-japan-seed.mjs",
    generatedAt: new Date().toISOString().slice(0, 10),
    sourceSeed: "japan-trip-seed.json",
    resolvedStopCount,
    totalStopCount: totalStops,
    coordinates,
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(overlay, null, 2)}\n`);

  console.log(`\nResolved ${resolvedStopCount}/${totalStops} stops (${resolved.length} unique lookups matched).`);
  console.log(`Unresolved: ${unresolvedStopCount} stops (${noMatch.length} no candidate in box, ${nameMismatch.length} in box but wrong venue, ${failed.length} lookup failed).`);
  if (noMatch.length > 0) {
    console.log("\nNo candidate in box:");
    for (const r of noMatch) {
      console.log(`  ${r.ids.join(", ")} — "${r.query}"`);
      for (const c of r.candidates ?? []) console.log(`      candidate: ${c.lat},${c.lng} ${c.canonicalName}`);
    }
  }
  if (nameMismatch.length > 0) {
    console.log("\nIn the box but a different venue (name identity, KI-39):");
    for (const r of nameMismatch) {
      console.log(`  ${r.ids.join(", ")} — "${r.query}"`);
      for (const c of r.candidates ?? []) console.log(`      rejected: ${c.lat},${c.lng} ${c.canonicalName}`);
    }
  }
  // Not a failure — a to-verify list. These pins rest on the box plus a
  // local-script name the check cannot read (see geocodeNameMatch.ts).
  if (unverified.length > 0) {
    console.log(`\nAccepted but name-unverified (${unverified.length} lookups — local-script name, box only):`);
    for (const r of unverified) console.log(`  ${r.ids.join(", ")} — "${r.query}" -> ${r.canonicalName}`);
  }
  if (failed.length > 0) {
    console.log("\nLookup failed (rate limit or vendor error — rerun to retry):");
    for (const r of failed) console.log(`  ${r.ids.join(", ")} — "${r.query}": ${r.detail}`);
  }
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

await main();
