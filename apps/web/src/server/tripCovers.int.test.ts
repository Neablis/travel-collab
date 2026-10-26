import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTripCommand } from "./commands";
import { isCanonicalCoverQuery, verifyCoverUrl } from "./coverProxy";
import { db } from "./db/client";
import { tripCovers } from "./db/schema";
import { fetchRemoteImage, type Fetcher } from "./external/remoteImage/fetchImage";
import { RemoteImageRefused, type Resolve } from "./external/remoteImage/guard";
import { listTripSummariesVisibleTo } from "./projections";
import { getTripCover, setTripCoverFromUrl } from "./tripCovers";

// Setting a trip's cover from a URL (M49 part 2, ADR-081 item 4), against
// real Postgres and a fake network: the guarded fetcher is the real one, given
// a fake `fetch` and a fake resolver, so no test here leaves the machine. A
// URL the fetcher refuses saves nothing; one it takes is stored as a reference
// and read back with the signed same-origin path a browser loads it from.

const OWNER = `url-cover-owner-${randomUUID().slice(0, 8)}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const resolve: Resolve = async (host) => [{ address: host === "inside.example.com" ? "169.254.169.254" : "93.184.216.34", family: 4 }];
const upstream: Record<string, () => Response> = {
  "https://cdn.example.com/harbour.png": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
  "https://cdn.example.com/bled_(11732502696).jpg": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
  "https://cdn.example.com/page.html": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
  "https://cdn.example.com/huge.png": () => new Response(new Uint8Array(64), { headers: { "content-type": "image/png" } }),
};
const fetch: Fetcher = async (url) => {
  const answer = upstream[url.href];
  if (answer === undefined) throw new Error(`unexpected fetch of ${url.href}`);
  return answer();
};
const fetchImage = (url: string) => fetchRemoteImage(url, { maxBytes: 32 }, { fetch, resolve });

async function seedTrip(): Promise<string> {
  const tripId = randomUUID();
  expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Leith" }, OWNER)).ok).toBe(true);
  return tripId;
}

const rowsOf = (tripId: string) => db.select().from(tripCovers).where(eq(tripCovers.tripId, tripId));

async function reasonFor(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(RemoteImageRefused);
  return (error as RemoteImageRefused).reason;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("setTripCoverFromUrl", () => {
  it.each([
    ["a URL that is not an image", "https://cdn.example.com/page.html", "not-an-image"],
    ["a URL on a private address", "https://inside.example.com/latest/meta-data/", "private-address"],
    ["a URL that is not https", "http://cdn.example.com/harbour.png", "not-https"],
    ["an image over the size cap", "https://cdn.example.com/huge.png", "too-large"],
  ])("refuses %s and saves nothing", async (_what, url, reason) => {
    const tripId = await seedTrip();
    expect(await reasonFor(setTripCoverFromUrl(tripId, { url }, OWNER, { fetchImage }))).toBe(reason);
    expect(await rowsOf(tripId)).toEqual([]);
  });

  it("refuses a URL whose signed path would not fit the contract, before fetching it", async () => {
    const tripId = await seedTrip();
    // Every `/` triples when the path encodes it, so 1,000 characters of URL
    // make a path well past the 2,048 a `proxySrc` may be.
    const url = `https://cdn.example.com/${"a/".repeat(500)}x.png`;
    const fetchSpy = vi.fn(fetchImage);
    expect(await reasonFor(setTripCoverFromUrl(tripId, { url }, OWNER, { fetchImage: fetchSpy }))).toBe("url-too-long");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await rowsOf(tripId)).toEqual([]);
  });

  it("leaves the cover a trip had when a new URL is refused", async () => {
    const tripId = await seedTrip();
    const kept = await setTripCoverFromUrl(tripId, { url: "https://cdn.example.com/harbour.png" }, OWNER, { fetchImage });
    expect(await reasonFor(setTripCoverFromUrl(tripId, { url: "https://cdn.example.com/page.html" }, OWNER, { fetchImage }))).toBe(
      "not-an-image",
    );
    expect(await getTripCover(tripId)).toEqual(kept);
  });

  it("stores a parenthesis URL whose minted path passes the proxy route's gates", async () => {
    const tripId = await seedTrip();
    // Production, 2026-10-26: this shape of name served nothing, because a
    // layer in front of the proxy normalized its parentheses.
    const url = "https://cdn.example.com/bled_(11732502696).jpg";
    const cover = await setTripCoverFromUrl(tripId, { url }, OWNER, { fetchImage });
    expect(cover).toMatchObject({ source: "url", url });
    if (cover.source !== "url") throw new Error("expected a URL cover");
    expect(cover.proxySrc).toMatch(/^\/api\/cover-image\?/);
    const parsed = new URL(cover.proxySrc!, "https://caesura.test");
    const signature = parsed.searchParams.get("s")!;
    expect(isCanonicalCoverQuery(parsed.search, url, signature)).toBe(true);
    expect(verifyCoverUrl(url, signature)).toBe(true);
  });

  it("refuses a URL the proxy could not serve, and saves nothing", async () => {
    const tripId = await seedTrip();
    // Signing unavailable: the minted path cannot verify, so the cover
    // would show as none rather than as the image.
    vi.stubEnv("COVER_PROXY_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(
      await reasonFor(setTripCoverFromUrl(tripId, { url: "https://cdn.example.com/harbour.png" }, OWNER, { fetchImage })),
    ).toBe("not-renderable");
    expect(await rowsOf(tripId)).toEqual([]);
  });

  it("stores an image's URL with its credit, framed at the centre unless told otherwise", async () => {
    const tripId = await seedTrip();
    const url = "https://cdn.example.com/harbour.png";
    const cover = await setTripCoverFromUrl(
      tripId,
      { url, alt: "The harbour at dusk", credit: { name: "Port of Leith", url: "https://leith.example/photos" } },
      OWNER,
      { fetchImage },
    );
    expect(cover).toMatchObject({
      source: "url",
      url,
      alt: "The harbour at dusk",
      credit: { name: "Port of Leith", url: "https://leith.example/photos" },
      position: 50,
    });
    const moved = await setTripCoverFromUrl(tripId, { url, position: 20 }, OWNER, { fetchImage });
    expect(moved).toMatchObject({ position: 20, alt: null, credit: null });
  });

  it("reads a URL cover back with a signed same-origin path, from the getter and the listing alike", async () => {
    const tripId = await seedTrip();
    const url = "https://cdn.example.com/harbour.png";
    await setTripCoverFromUrl(tripId, { url }, OWNER, { fetchImage });

    const fromGetter = await getTripCover(tripId);
    const listed = (await listTripSummariesVisibleTo(OWNER)).find((trip) => trip.tripId === tripId);
    for (const cover of [fromGetter, listed?.cover]) {
      expect(cover).toMatchObject({ source: "url", url });
      const src = new URL((cover as { proxySrc: string }).proxySrc, "https://caesura.test");
      expect(src.origin).toBe("https://caesura.test");
      expect(src.pathname).toBe("/api/cover-image");
      expect(src.searchParams.get("u")).toBe(url);
      expect(verifyCoverUrl(url, src.searchParams.get("s")!)).toBe(true);
    }
  });

  it("lists a URL cover without its path when production has no signing key, rather than failing the listing", async () => {
    const tripId = await seedTrip();
    const url = "https://cdn.example.com/harbour.png";
    await setTripCoverFromUrl(tripId, { url }, OWNER, { fetchImage });
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("COVER_PROXY_SECRET", "");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const listed = (await listTripSummariesVisibleTo(OWNER)).find((trip) => trip.tripId === tripId);
    const fromGetter = await getTripCover(tripId);
    for (const cover of [listed?.cover, fromGetter]) {
      expect(cover).toMatchObject({ source: "url", url });
      expect(cover).not.toHaveProperty("proxySrc");
    }
    expect(logged.mock.calls.filter(([message]) => String(message).includes("without proxySrc"))).toHaveLength(1);
  });
});
