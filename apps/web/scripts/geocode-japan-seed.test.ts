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
import { resolveJob, vendorErrorStatus, type Job, type Unresolved } from "./geocode-japan-seed.mts";

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
