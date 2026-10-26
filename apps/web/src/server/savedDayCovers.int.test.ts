// Setting a playbook day's cover from a URL (Mitchell, 2026-10-26), against
// real Postgres and a fake network: the guarded fetcher is the real one, given
// a fake `fetch` and a fake resolver, so no test here leaves the machine. A
// URL the fetcher refuses saves nothing; one it takes is stored as a
// reference and read back with the signed same-origin path a browser loads it
// from. Position moves on either kind of cover, as the route promises.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coverValues } from "./coverRows";
import { isCanonicalCoverQuery, verifyCoverUrl } from "./coverProxy";
import { db } from "./db/client";
import { savedDayCovers } from "./db/schema";
import { fetchRemoteImage, type Fetcher } from "./external/remoteImage/fetchImage";
import { RemoteImageRefused, type Resolve } from "./external/remoteImage/guard";
import {
  clearSavedDayCover,
  getSavedDayCover,
  setSavedDayCoverFromUrl,
  setSavedDayCoverPosition,
} from "./savedDayCovers";
import { storeSavedDay } from "./savedDays";

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

async function seedDay(): Promise<string> {
  const saved = await storeSavedDay({
    ownerId: OWNER,
    name: "Leith",
    stops: [
      {
        title: "The harbour",
        timeWindow: { start: "09:00", end: "12:00" },
        location: { name: "The Shore", city: "Edinburgh", countryCode: "GB" },
        notes: "",
        anchors: [],
        kind: "planned",
        tags: [],
        cost: null,
        dayIndex: 0,
        mode: null,
        endLocation: null,
        pendingReason: null,
        flightNumber: null,
      },
    ],
    dayCount: 1,
    sourceTripId: randomUUID(),
    sourceTripName: "Leith",
    now: new Date().toISOString(),
    context: { route: "savedDayCovers.int.test" },
  });
  expect(saved.ok).toBe(true);
  return saved.ok ? saved.value.savedDayId : "";
}

const rowsOf = (savedDayId: string) =>
  db.select().from(savedDayCovers).where(eq(savedDayCovers.savedDayId, savedDayId));

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

describe("setSavedDayCoverFromUrl", () => {
  it.each([
    ["a URL that is not an image", "https://cdn.example.com/page.html", "not-an-image"],
    ["a URL on a private address", "https://inside.example.com/latest/meta-data/", "private-address"],
    ["a URL that is not https", "http://cdn.example.com/harbour.png", "not-https"],
    ["an image over the size cap", "https://cdn.example.com/huge.png", "too-large"],
  ])("refuses %s and saves nothing", async (_what, url, reason) => {
    const savedDayId = await seedDay();
    expect(await reasonFor(setSavedDayCoverFromUrl(savedDayId, { url }, OWNER, { fetchImage }))).toBe(reason);
    expect(await rowsOf(savedDayId)).toEqual([]);
  });

  it("refuses a URL whose signed path would not fit the contract, before fetching it", async () => {
    const savedDayId = await seedDay();
    // Every `/` triples when the path encodes it, so 1,000 characters of URL
    // make a path well past the 2,048 a `proxySrc` may be.
    const url = `https://cdn.example.com/${"a/".repeat(500)}x.png`;
    const fetchSpy = vi.fn(fetchImage);
    expect(await reasonFor(setSavedDayCoverFromUrl(savedDayId, { url }, OWNER, { fetchImage: fetchSpy }))).toBe(
      "url-too-long",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await rowsOf(savedDayId)).toEqual([]);
  });

  it("leaves the cover a day had when a new URL is refused", async () => {
    const savedDayId = await seedDay();
    const kept = await setSavedDayCoverFromUrl(
      savedDayId,
      { url: "https://cdn.example.com/harbour.png" },
      OWNER,
      { fetchImage },
    );
    expect(
      await reasonFor(
        setSavedDayCoverFromUrl(savedDayId, { url: "https://cdn.example.com/page.html" }, OWNER, { fetchImage }),
      ),
    ).toBe("not-an-image");
    expect(await getSavedDayCover(savedDayId)).toEqual(kept);
  });

  it("stores a parenthesis URL whose minted path passes the proxy route's gates", async () => {
    const savedDayId = await seedDay();
    // Production, 2026-10-26: this shape of name served nothing, because a
    // layer in front of the proxy normalized its parentheses.
    const url = "https://cdn.example.com/bled_(11732502696).jpg";
    const cover = await setSavedDayCoverFromUrl(savedDayId, { url }, OWNER, { fetchImage });
    expect(cover).toMatchObject({ source: "url", url });
    if (cover.source !== "url") throw new Error("expected a URL cover");
    expect(cover.proxySrc).toMatch(/^\/api\/cover-image\?/);
    const parsed = new URL(cover.proxySrc!, "https://caesura.test");
    const signature = parsed.searchParams.get("s")!;
    expect(isCanonicalCoverQuery(parsed.search, url, signature)).toBe(true);
    expect(verifyCoverUrl(url, signature)).toBe(true);
  });

  it("refuses a URL the proxy could not serve, and saves nothing", async () => {
    const savedDayId = await seedDay();
    // Signing unavailable: the minted path cannot verify, so the cover
    // would show as none rather than as the image.
    vi.stubEnv("COVER_PROXY_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(
      await reasonFor(
        setSavedDayCoverFromUrl(savedDayId, { url: "https://cdn.example.com/harbour.png" }, OWNER, { fetchImage }),
      ),
    ).toBe("not-renderable");
    expect(await rowsOf(savedDayId)).toEqual([]);
  });

  it("stores an image's URL with its credit, framed at the centre unless told otherwise", async () => {
    const savedDayId = await seedDay();
    const url = "https://cdn.example.com/harbour.png";
    const cover = await setSavedDayCoverFromUrl(
      savedDayId,
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
    const moved = await setSavedDayCoverFromUrl(savedDayId, { url, position: 20 }, OWNER, { fetchImage });
    expect(moved).toMatchObject({ position: 20, alt: null, credit: null });
  });
});

describe("setSavedDayCoverPosition", () => {
  it("moves a URL cover and leaves the image as it was", async () => {
    const savedDayId = await seedDay();
    await setSavedDayCoverFromUrl(savedDayId, { url: "https://cdn.example.com/harbour.png" }, OWNER, { fetchImage });
    const moved = await setSavedDayCoverPosition(savedDayId, 85);
    expect(moved).toMatchObject({ source: "url", url: "https://cdn.example.com/harbour.png", position: 85 });
    expect(await getSavedDayCover(savedDayId)).toMatchObject({ position: 85 });
  });

  it("moves an Unsplash cover too: the framing column is the row's, not the source's", async () => {
    const savedDayId = await seedDay();
    await db.insert(savedDayCovers).values({
      savedDayId,
      ...coverValues(
        {
          id: "harbour",
          urls: {
            raw: "https://images.unsplash.com/harbour",
            regular: "https://images.unsplash.com/harbour?w=1080",
            small: "https://images.unsplash.com/harbour?w=400",
          },
          alt: "The harbour",
          photographerName: "Port of Leith",
          photographerUrl: "https://unsplash.com/@leith",
          photoPageUrl: "https://unsplash.com/photos/harbour",
          downloadLocation: "https://api.unsplash.com/photos/harbour/download",
        },
        OWNER,
        new Date(),
      ),
    });
    const moved = await setSavedDayCoverPosition(savedDayId, 15);
    expect(moved).toMatchObject({ source: "unsplash", unsplashId: "harbour", position: 15 });
  });

  it("answers null when the day has no cover to move", async () => {
    const savedDayId = await seedDay();
    expect(await setSavedDayCoverPosition(savedDayId, 40)).toBeNull();
  });
});

describe("clearSavedDayCover", () => {
  it("clears the cover, and clearing a day with none is not an error", async () => {
    const savedDayId = await seedDay();
    await setSavedDayCoverFromUrl(savedDayId, { url: "https://cdn.example.com/harbour.png" }, OWNER, { fetchImage });
    await clearSavedDayCover(savedDayId);
    expect(await rowsOf(savedDayId)).toEqual([]);
    expect(await getSavedDayCover(savedDayId)).toBeNull();
    await clearSavedDayCover(savedDayId);
    expect(await rowsOf(savedDayId)).toEqual([]);
  });
});
