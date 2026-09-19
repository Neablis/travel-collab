// The place-search adapter — **the far side of the kernel's port mock**.
//
// `places.test.ts` drives the tool against a stubbed `PlaceSearchPort`, which
// is the right shape for testing the tool and says nothing at all about what
// the port DOES. M9 Phase 0's retro is about exactly that gap: a mock is a
// boundary, and the code beyond it is untested until something asserts the
// wire. This file is that assertion, and what it asserts is KI-93 — that the
// AI path's lookups are charged against the same geocode ceilings the
// `/api/geocode` proxy has always been charged against.
//
// The counter store itself is `quota.int.test.ts`'s; what is testable here is
// the adapter's own three rules: charge before you look up, stop at the first
// refusal, and pace the vendor.
import { describe, expect, it, vi } from "vitest";
import { createPlaceSearchPort, placeSearchPort } from "./assistantPorts";
import { MIN_INTERVAL_MS } from "./rateLimit";

const REGION = { minLat: 42, maxLat: 44, minLng: -80, maxLng: -78 };

function harness(opts: { allow?: boolean[]; forward?: ReturnType<typeof vi.fn> } = {}) {
  const charged: string[] = [];
  const slept: number[] = [];
  // **One ordered list, because counting cannot see order** (CodeRabbit, PR
  // #188). "Charges ... before the vendor is asked" was asserted with two
  // separate tallies, which an implementation that forwards first and charges
  // afterwards satisfies exactly as well. The repo's own review rule — flag a
  // test that asserts nothing on the path it claims to cover — is what this
  // was failing.
  const events: string[] = [];
  let call = 0;
  const forward =
    opts.forward ??
    vi.fn(async (query: string) => [
      { canonicalName: `${query} — found`, lat: 43.08, lng: -79.06, city: "Niagara Falls", countryCode: "US" },
    ]);
  const port = createPlaceSearchPort({
    geocoder: () =>
      ({
        // The cast is what the old `({ forward }) as never` was doing
        // implicitly: `vi.fn()`'s default type is not callable with arguments,
        // and this is the first code to call it in a typed position.
        forward: async (query: string, options?: unknown) => {
          events.push(`forward:${query}`);
          return (forward as unknown as (q: string, o?: unknown) => Promise<unknown[]>)(
            query,
            options,
          );
        },
      }) as never,
    charge: async (userId) => {
      charged.push(userId);
      events.push(`charge:${userId}`);
      return opts.allow?.[call++] ?? true;
    },
    sleep: async (ms) => void slept.push(ms),
  });
  return { port, charged, slept, forward, events };
}

describe("the place search port", () => {
  it("charges the geocode quota once per query, before the vendor is asked", async () => {
    const { port, charged, forward, events } = harness();
    await port.search({ queries: ["falls", "lunch", "hotel"], region: REGION, userId: "asker" });
    expect(charged).toEqual(["asker", "asker", "asker"]);
    expect(forward).toHaveBeenCalledTimes(3);
    // The order is the claim: a charge that lands after its own lookup has
    // already spent the request it was supposed to authorise.
    expect(events).toEqual([
      "charge:asker",
      "forward:falls",
      "charge:asker",
      "forward:lunch",
      "charge:asker",
      "forward:hotel",
    ]);
  });

  // **The mid-batch decision, taken in the plan on KI-93's own argument:** a
  // ceiling stops further lookups and does not fail the request. The queries
  // that already resolved keep their places, so a turn that found three of five
  // still has three.
  it("stops at the first refusal, keeps what it already found, and charges nothing more", async () => {
    const { port, charged, forward } = harness({ allow: [true, false, true] });
    const lookups = await port.search({ queries: ["a", "b", "c"], region: null, userId: "asker" });

    expect(lookups[0]!.places).toHaveLength(1);
    expect(lookups[0]!.skipped).toBeUndefined();
    expect(lookups[1]!).toMatchObject({ query: "b", places: [], skipped: "quota" });
    expect(lookups[2]!).toMatchObject({ query: "c", places: [], skipped: "quota" });
    // Two charges, not three: `consumeQuota` bumps a counter before it
    // compares, so asking again after a ceiling would inflate the user's own
    // daily count with lookups that never happened.
    expect(charged).toHaveLength(2);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("never asks the vendor for a query the quota refused", async () => {
    const { port, forward } = harness({ allow: [false] });
    const lookups = await port.search({ queries: ["a", "b"], region: null, userId: "asker" });
    expect(forward).not.toHaveBeenCalled();
    expect(lookups.every((lookup) => lookup.skipped === "quota")).toBe(true);
  });

  // LocationIQ's free tier is 2 requests/second and the per-second limit is the
  // one that actually binds — it is what broke the 2026-08-02 dogfood run.
  // Paced BETWEEN vendor calls: never before the first, and never for a query
  // that contacted no vendor.
  it("paces the vendor, and does not sleep for a query it never sent", async () => {
    const { port, slept } = harness();
    await port.search({ queries: ["a", "b", "c"], region: null, userId: "asker" });
    expect(slept).toEqual([MIN_INTERVAL_MS, MIN_INTERVAL_MS]);

    // Refused outright: no vendor was contacted, so there is nothing to pace.
    const refused = harness({ allow: [false, false] });
    await refused.port.search({ queries: ["a", "b"], region: null, userId: "asker" });
    expect(refused.slept).toEqual([]);

    // **A query whose call THREW still spent a request against the per-second
    // limit**, so the next one is still paced. This is the case the first
    // spelling of this rule got wrong — it read the condition off the RESULTS,
    // where a thrown query looks identical to one that was never sent — and the
    // case the original assertion could not catch, because a refusal
    // short-circuits before the sleep is even reached.
    const threw = harness({
      forward: vi.fn(async (query: string) => {
        if (query === "a") throw new Error("vendor 500");
        return [{ canonicalName: query, lat: 1, lng: 2 }];
      }),
    });
    await threw.port.search({ queries: ["a", "b"], region: null, userId: "asker" });
    expect(threw.slept).toEqual([MIN_INTERVAL_MS]);
  });

  it("passes the region as a viewbox, and omits it entirely when there is none", async () => {
    const { port, forward } = harness();
    await port.search({ queries: ["a"], region: REGION, userId: "asker" });
    expect(forward.mock.calls[0]![1]).toMatchObject({ viewbox: REGION });

    const blank = harness();
    await blank.port.search({ queries: ["a"], region: null, userId: "asker" });
    expect(blank.forward.mock.calls[0]![1]).not.toHaveProperty("viewbox");
  });

  // A vendor 500 on one name must not cost the other four their lookups — and
  // a missing `LOCATIONIQ_API_KEY` surfaces the same way, because `getGeocoder`
  // throws and the next query's call throws again.
  it("reports one failed query as unavailable and keeps going", async () => {
    const forward = vi.fn(async (query: string) => {
      if (query === "b") throw new Error("vendor 500");
      return [{ canonicalName: `${query} — found`, lat: 1, lng: 2 }];
    });
    const { port } = harness({ forward });
    const lookups = await port.search({ queries: ["a", "b", "c"], region: null, userId: "asker" });
    expect(lookups.map((lookup) => lookup.skipped)).toEqual([undefined, "unavailable", undefined]);
    expect(lookups[2]!.places).toHaveLength(1);
  });

  // The whole value of a citation is that the server holds a coordinate nobody
  // guessed. A candidate with no coordinates would issue a `placeRef` that
  // resolves to a name and nothing else — which is what the model could already
  // have typed.
  it("refuses to number a candidate the vendor gave no coordinates for", async () => {
    const forward = vi.fn(async () => [
      { canonicalName: "Somewhere", lat: Number.NaN, lng: 2 },
      { canonicalName: "Real place", lat: 43.08, lng: -79.06 },
    ]);
    const { port } = harness({ forward });
    const [lookup] = await port.search({ queries: ["a"], region: null, userId: "asker" });
    expect(lookup!.places.map((place) => place.name)).toEqual(["Real place"]);
  });

  it("carries the vendor's structured address through, and omits what it did not answer", async () => {
    const forward = vi.fn(async () => [
      { canonicalName: "Top of the Falls", lat: 43.08, lng: -79.06, city: "Niagara Falls", countryCode: "US" },
      { canonicalName: "Bare", lat: 1, lng: 2 },
    ]);
    const { port } = harness({ forward });
    const [lookup] = await port.search({ queries: ["a"], region: null, userId: "asker" });
    expect(lookup!.places[0]).toEqual({
      name: "Top of the Falls",
      lat: 43.08,
      lng: -79.06,
      city: "Niagara Falls",
      countryCode: "US",
    });
    expect(lookup!.places[1]).toEqual({ name: "Bare", lat: 1, lng: 2 });
  });

  // The shipped instance exists and is the one the app wires. Its edges are the
  // real ones, so this is the only thing about it worth asserting here.
  it("ships one instance", () => {
    expect(typeof placeSearchPort.search).toBe("function");
  });
});
