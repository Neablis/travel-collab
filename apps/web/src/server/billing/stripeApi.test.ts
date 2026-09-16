import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeStripeKey } from "@/test-support/stripeSignature";
import {
  findPriceByLookupKey,
  retrieveSubscriptionWithItems,
} from "./stripeApi";

// **The wire, which every other billing test mocks away.**
//
// `prices.test.ts` replaces `findPriceByLookupKey` with a `vi.fn`, which is the
// right call for testing resolution logic and is exactly why a defect *inside*
// that function reached production: on 2026-09-16 every paid path — first
// checkout and plan change alike — answered 500, because
// `Stripe GET /prices failed with 400: Invalid array`. `lookup_keys` is an
// ARRAY parameter in Stripe's API, and it was being sent as a scalar.
//
// So these assert the thing no mock can: the URL that actually leaves the
// process. The layer below the mock line had no test file at all.
//
// Nothing here talks to Stripe. `fetch` is stubbed, and the assertions are on
// the request that was built, not on any response.

const fetchMock = vi.fn();

// A FRESH `Response` per call. `findPriceByLookupKey` makes two requests, and a
// single Response instance handed to both throws "Body has already been read" —
// which looks like a source defect and is not one.
function okJson(body: unknown): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

/** The URL of the Nth `fetch` call, parsed. */
function requestedUrl(call: number): URL {
  const [input] = fetchMock.mock.calls[call] as [string];
  return new URL(input);
}

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
    saved.set(key, process.env[key]);
  }
  process.env.STRIPE_SECRET_KEY = fakeStripeKey("sk_test");
  process.env.STRIPE_WEBHOOK_SECRET = fakeStripeKey("whsec");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    okJson({ object: "list", data: [] })(),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("findPriceByLookupKey", () => {
  // The regression. Stripe documents `lookup_keys` as an array, and rejects a
  // scalar with `400: Invalid array` rather than treating it as a one-element
  // list — so this is not a style preference, it is the difference between a
  // working checkout and a 500.
  it("sends lookup_keys as an array parameter, not a scalar", async () => {
    await findPriceByLookupKey("plus_v1_usd_900");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of [0, 1]) {
      const url = requestedUrl(call);
      expect(url.searchParams.getAll("lookup_keys[]")).toEqual([
        "plus_v1_usd_900",
      ]);
      // The scalar spelling is what Stripe refuses. Asserting its ABSENCE is
      // what keeps a "fix" that sends both from passing this file.
      expect(url.searchParams.has("lookup_keys")).toBe(false);
    }
  });

  it("asks for the active and the archived listing of the same key", async () => {
    await findPriceByLookupKey("premium_v1_usd_1900");

    const actives = [requestedUrl(0), requestedUrl(1)]
      .map((url) => url.searchParams.get("active"))
      .sort();
    expect(actives).toEqual(["false", "true"]);
    for (const call of [0, 1]) {
      expect(requestedUrl(call).pathname).toBe("/v1/prices");
    }
  });

  it("prefers the active price when both listings answer", async () => {
    fetchMock
      .mockImplementationOnce(async () =>
        okJson({ object: "list", data: [{ id: "price_active" }] })(),
      )
      .mockImplementationOnce(async () =>
        okJson({ object: "list", data: [{ id: "price_archived" }] })(),
      );

    const found = await findPriceByLookupKey("plus_v1_usd_900");

    expect(found?.id).toBe("price_active");
  });
});

describe("retrieveSubscriptionWithItems", () => {
  // `expand[]` was already spelled correctly in the source; this pins it so the
  // two array parameters in this module cannot drift apart again.
  it("expands the price with an array parameter", async () => {
    fetchMock.mockImplementation(async () => okJson({ id: "sub_123" })());

    await retrieveSubscriptionWithItems("sub_123");

    const url = requestedUrl(0);
    expect(url.pathname).toBe("/v1/subscriptions/sub_123");
    expect(url.searchParams.getAll("expand[]")).toEqual(["items.data.price"]);
  });
});
