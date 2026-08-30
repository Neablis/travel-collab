// The one thing in geocode-japan-seed.mts that is a decision rather than a
// transcript of a vendor call: which of two thrown errors is a definitive
// "no such place" and which is worth rerunning (KI-78).
//
// Driven with a stub Geocoder, so this costs no LocationIQ quota and is
// deterministic — the nine stops that hit this on every real run are nine
// stops precisely because a 404 is not transient.
//
// Lives beside the script rather than under src/ because the thing it covers
// does, the same reason next.config.test.ts and sentry.shared.test.ts sit at
// the app root; vitest.unit.config.ts's node project names all three.
import { describe, expect, it } from "vitest";
import type { Geocoder } from "@/server/geocoding/geocoder";
import { readFileSync } from "node:fs";
import { CITY_OVERRIDES, JAPAN_STOPS, parseTripSeed } from "@tc/fixtures";
import { resolveJob, vendorErrorStatus, buildJobs, CITY_VIEWBOXES, type Job, type Unresolved } from "./geocode-japan-seed.mts";

const TOKYO = { minLat: 35.5, maxLat: 35.85, minLng: 139.3, maxLng: 139.95 };

const job: Job = {
  key: "stop|Tokyo|Koffee Mameya|Shibuya",
  query: "Koffee Mameya, Shibuya, Tokyo, Japan",
  place: "Koffee Mameya",
  area: "Shibuya",
  context: ["Shibuya", "Tokyo", "Japan"],
  viewbox: TOKYO,
  acceptBoxes: [TOKYO],
  ids: ["d02-s4-coffee"],
};

function throwingGeocoder(err: unknown): Geocoder {
  return {
    forward: async () => {
      throw err;
    },
  };
}

async function reasonFor(err: unknown): Promise<string> {
  const result = (await resolveJob(throwingGeocoder(err), job)) as Unresolved;
  return result.reason;
}

describe("vendorErrorStatus", () => {
  it("reads the status out of the vendor adapter's own non-2xx throw", () => {
    // Exactly what createLocationIQGeocoder throws — see locationiq.ts.
    expect(vendorErrorStatus(new Error("geocode failed: 404"))).toBe("404");
    expect(vendorErrorStatus(new Error("geocode failed: 429"))).toBe("429");
  });

  it("claims nothing about any other failure", () => {
    // A network failure, an abort, a JSON parse error, a non-Error throw:
    // none of these carry a vendor verdict, so none may be read as one.
    expect(vendorErrorStatus(new TypeError("fetch failed"))).toBeUndefined();
    expect(vendorErrorStatus(new Error("geocode failed: soon"))).toBeUndefined();
    expect(vendorErrorStatus(new Error("wrapped: geocode failed: 404"))).toBeUndefined();
    expect(vendorErrorStatus("geocode failed: 404")).toBeUndefined();
  });
});

describe("resolveJob outcome classification (KI-78)", () => {
  it("reports LocationIQ's zero-result 404 as a definitive miss, not a retryable failure", async () => {
    // LocationIQ answers a zero-result query with HTTP 404 and
    // {"error":"Unable to geocode"} rather than an empty list, so this is
    // what "the vendor has no such place" actually looks like at this seam.
    await expect(reasonFor(new Error("geocode failed: 404"))).resolves.toBe("no-results");
  });

  it("still reports a rate limit as retryable", async () => {
    // The outcome the "rerun to retry" heading exists for. If this ever
    // collapses into no-results, a real 429 becomes an unrerun miss.
    await expect(reasonFor(new Error("geocode failed: 429"))).resolves.toBe("lookup-failed");
  });

  it("still reports every other vendor failure as retryable", async () => {
    await expect(reasonFor(new Error("geocode failed: 500"))).resolves.toBe("lookup-failed");
    await expect(reasonFor(new TypeError("fetch failed"))).resolves.toBe("lookup-failed");
  });

  it("keeps the error text on both, so the report can still say which status", async () => {
    const noResults = (await resolveJob(
      throwingGeocoder(new Error("geocode failed: 404")),
      job,
    )) as Unresolved;
    expect(noResults.detail).toBe("Error: geocode failed: 404");

    // The other half of "on both". Asserting only the 404 above left this
    // test's own name unenforced: `lookup-failed` could stop carrying `detail`
    // and the retry report would lose the vendor status with this suite still
    // green. Same species as KI-1 and KI-14 — a comment asserting an invariant
    // nothing checks.
    const retryable = (await resolveJob(
      throwingGeocoder(new Error("geocode failed: 429")),
      job,
    )) as Unresolved;
    expect(retryable.detail).toBe("Error: geocode failed: 429");
  });

  it("does not confuse a vendor 404 with an empty-but-successful response", async () => {
    // The other shape a zero-result answer could arrive in. It is not what
    // LocationIQ sends, but it is a legitimate Geocoder response and must
    // land on the box outcome, not on either error outcome.
    const empty: Geocoder = { forward: async () => [] };
    const result = (await resolveJob(empty, job)) as Unresolved;
    expect(result.reason).toBe("no-candidate-in-box");
  });
});

describe("buildJobs asks for the city a stop is physically in (KI-59)", () => {
  const seed = parseTripSeed(
    JSON.parse(readFileSync(new URL("../../../.design-sync/handoff/data/japan-trip-seed.json", import.meta.url), "utf-8")),
  );
  const jobs = buildJobs(seed);
  const jobFor = (id: string) => jobs.find((j) => j.ids.includes(id));

  // The upstream export models city per DAY and tags a travel day with its
  // destination, so this script used to send queries no vendor could satisfy.
  // These are the seven stops CITY_OVERRIDES corrects, with the query each one
  // must now produce. Written out rather than derived from CITY_OVERRIDES: a
  // test that reads the same map the code reads agrees with it by
  // construction and proves nothing.
  const EXPECTED: ReadonlyArray<readonly [string, string]> = [
    ["d4-s1-limited-express-to-nikko", "Tobu Asakusa Station, Asakusa, Tokyo, Japan"],
    ["d6-s1-romancecar-to-hakone-yumoto", "Shinjuku Station, Shinjuku, Tokyo, Japan"],
    ["d7-s1-shinkansen-odawara-kyoto", "Odawara Station, Odawara, Odawara, Japan"],
    ["d11-s1-train-kyoto-osaka", "Kyoto Station, Shimogyō, Kyoto, Japan"],
    ["d13-s1-train-and-ferry-to-naoshima", "Uno Port, Tamano, Tamano, Japan"],
    ["d14-s1-breakfast-at-the-hotel", "Zentis Osaka, Kita, Osaka, Japan"],
    ["d14-s2-shinkansen-to-tokyo", "Shin-Osaka Station, Yodogawa, Osaka, Japan"],
  ];

  it.each(EXPECTED)("%s queries %s", (id, query) => {
    expect(jobFor(id)?.query).toBe(query);
  });

  it("covers every override, so a new one cannot be added without a query here", () => {
    expect([...Object.keys(CITY_OVERRIDES)].sort()).toEqual(EXPECTED.map(([id]) => id).sort());
  });

  it("leaves a stop with no override on its day's city", () => {
    // Day 14's later stops really are in Tokyo; only the morning moved.
    expect(jobFor("d14-s3-last-lunch-at-maisen")?.query).toBe("Tonkatsu Maisen, Omotesandō, Tokyo, Japan");
  });

  it("has a viewbox for every city an override names", () => {
    const missing = [...new Set(Object.values(CITY_OVERRIDES).map((o) => o.ours))].filter(
      (city) => CITY_VIEWBOXES[city] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("puts each overridden stop's own coordinate inside the box it will be searched in", () => {
    // The box is the hard bound this script enforces on a candidate, so a box
    // that excludes the venue's real location can never accept it — KI-59's
    // failure in a different shape.
    //
    // Coordinates come from JAPAN_STOPS (canonical since ADR-030), NOT from
    // the seed export: the export's stops carry no coordinates at all, so the
    // first draft of this test skipped every row and passed while Odawara's
    // box sat a full degree of latitude off. The `toHaveLength` floor below is
    // what makes that failure mode visible rather than silent.
    const checked = JAPAN_STOPS.filter((s) => CITY_OVERRIDES[s.id]);
    expect(checked).toHaveLength(Object.keys(CITY_OVERRIDES).length);

    const outside = checked
      .filter((s) => {
        const box = CITY_VIEWBOXES[CITY_OVERRIDES[s.id]!.ours]!;
        return s.lat < box.minLat || s.lat > box.maxLat || s.lng < box.minLng || s.lng > box.maxLng;
      })
      .map((s) => `${s.id} (${s.lat}, ${s.lng}) is outside ${CITY_OVERRIDES[s.id]!.ours}'s viewbox`);
    expect(outside).toEqual([]);
  });
});

