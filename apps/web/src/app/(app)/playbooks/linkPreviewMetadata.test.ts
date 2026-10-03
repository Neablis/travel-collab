import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import type { SavedDay } from "@tc/contracts";
import type { SharedDayView } from "@/lib/sharedDayView";
import { NOINDEX_FOLLOW } from "@/lib/siteMetadata";

const sharedDayViewMock = vi.fn();
vi.mock("@/server/sharedDayView", () => ({ sharedDayView: (...a: unknown[]) => sharedDayViewMock(...a) }));
vi.mock("@/server/auth", () => ({ auth: async () => ({ user: { id: "dev-reader" } }) }));

import { metadata as boardMetadata } from "./board/page";
import { generateMetadata as dayMetadata } from "./day/[savedDayId]/page";
import { generateMetadata as discoverMetadata } from "./page";
import { generateMetadata as profileMetadata } from "./profile/[userId]/page";

// Spec 2026-10-02 §2.7, "Link previews": which card each Playbooks page points
// og:image at. The `meta` routes are stubbed — what they answer is
// `app/api/og/playbooks/routes.int.test.ts`. The day page asks no route: it
// reads the day itself, and that read is stubbed instead.

const DAY_ID = "aa000000-0000-4000-8000-000000000001";
const DAY: SavedDay = {
  savedDayId: DAY_ID,
  ownerId: "dev-alice",
  name: "Castle and canals",
  stops: [],
  dayCount: 2,
  cities: ["Osaka", "Kyoto"],
  visibility: "public",
  authorKind: "human",
  adds: 0,
  sourceTripId: "00000000-0000-4000-8000-00000000f000",
  sourceTripName: "Japan",
  createdAt: "2026-08-04T00:00:00.000Z",
  version: 1,
  summary: null,
};

const SITE_IMAGE = "/opengraph-image.png";
const PLAYBOOKS_IMAGE = "/api/og/playbooks";

function stubMeta(response: Response | Error) {
  const fetchMock = vi.fn(async (_url: URL | string) => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function ogImageUrls(metadata: Metadata): string[] {
  const images = metadata.openGraph?.images;
  const list = images === undefined ? [] : Array.isArray(images) ? images : [images];
  return list.map((image) => (typeof image === "string" || image instanceof URL ? String(image) : String(image.url)));
}

const discover = (params: Record<string, string | string[]>) =>
  discoverMetadata({ searchParams: Promise.resolve(params) });

afterEach(() => {
  vi.unstubAllGlobals();
  sharedDayViewMock.mockReset();
});

describe("/playbooks metadata", () => {
  it("points og:image at one city's card for exactly one ?city=", async () => {
    const fetchMock = stubMeta(Response.json({ title: "Kyoto playbooks", description: "7 days" }));

    const metadata = await discover({ city: "Kyoto", sort: "newest" });

    expect(ogImageUrls(metadata)).toEqual(["/api/og/playbooks/city/Kyoto", SITE_IMAGE]);
    expect(metadata.openGraph?.title).toBe("Kyoto playbooks");
    expect(metadata.title).toBe("Playbooks");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/og\/playbooks\/city\/Kyoto\/meta$/);
  });

  it("encodes the city into one path segment", async () => {
    stubMeta(Response.json({ title: "São Paulo playbooks", description: "2 days" }));

    const metadata = await discover({ city: "São Paulo/x" });

    expect(ogImageUrls(metadata)[0]).toBe("/api/og/playbooks/city/S%C3%A3o%20Paulo%2Fx");
  });

  it.each([
    ["no city", {}],
    ["two cities", { city: ["Kyoto", "Osaka"] }],
    ["a city and a country", { city: "Kyoto", country: "JP" }],
  ])("keeps the static Playbooks card, and asks nothing, for %s", async (_case, params) => {
    const fetchMock = stubMeta(new Error("must not be called"));

    const metadata = await discover(params);

    expect(ogImageUrls(metadata)).toEqual([PLAYBOOKS_IMAGE, SITE_IMAGE]);
    expect(metadata.openGraph?.title).toBe("Playbooks on Caesura");
    expect(metadata.title).toBe("Playbooks");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the static Playbooks card when the city lookup fails", async () => {
    stubMeta(new Error("connection refused"));

    expect(ogImageUrls(await discover({ city: "Kyoto" }))).toEqual([PLAYBOOKS_IMAGE, SITE_IMAGE]);
  });
});

describe("/playbooks/day/<slug>-<id> metadata", () => {
  // The day page reads in-process (SEO pass, D5); the read itself is covered
  // through `api/saved-days/[savedDayId]/route.int.test.ts` and
  // `server/sharedDayView.test.ts`. Here: what the <head> says about each answer.
  const view = (over: { day?: Partial<SavedDay>; moderation?: SharedDayView["moderation"] } = {}): SharedDayView => ({
    day: { ...DAY, ...over.day },
    isAuthor: false,
    author: { userId: "dev-alice", displayName: "Alice C.", playbooksShared: 1, adds: 0, reviewsReceived: 0, averageRating: null },
    pinning: false,
    publishedAt: null,
    moderation: over.moderation ?? null,
  });
  const head = (segment: string = DAY_ID) => dayMetadata({ params: Promise.resolve({ savedDayId: segment }) });

  it("names the tab for the day and its first city, the card for the day alone", async () => {
    sharedDayViewMock.mockResolvedValue(view());

    const metadata = await head(`an-old-name-${DAY_ID}`);

    expect(sharedDayViewMock).toHaveBeenCalledWith(DAY_ID, "dev-reader");
    expect(metadata.title).toBe("Castle and canals · Osaka");
    expect(metadata.openGraph?.title).toBe("Castle and canals");
    expect(ogImageUrls(metadata)).toEqual([`/api/og/playbooks/day/${DAY_ID}`, SITE_IMAGE]);
    // The canonical is built from the day, not from the segment asked for.
    expect(metadata.alternates?.canonical).toBe(`/playbooks/day/castle-and-canals-${DAY_ID}`);
    expect(metadata.robots).toBeUndefined();
  });

  it("describes it with the facts line, or the author's summary when there is one", async () => {
    sharedDayViewMock.mockResolvedValue(view());
    expect((await head()).description).toBe("Osaka, Kyoto · 2 days · 0 stops · by Alice C.");

    sharedDayViewMock.mockResolvedValue(view({ day: { summary: "Moats, then boats." } }));
    expect((await head()).description).toBe("Moats, then boats.");
  });

  it("leaves the city out of the tab for a day that names none", async () => {
    sharedDayViewMock.mockResolvedValue(view({ day: { cities: [] } }));
    expect((await head()).title).toBe("Castle and canals");
  });

  it.each([
    ["the author's own private day", { day: { visibility: "private" as const } }],
    ["a published day an operator hid, on its author's read", { moderation: { moderatedAt: "2026-09-23T00:00:00.000Z", moderationNote: null } }],
  ])("keeps %s out of the index", async (_case, over) => {
    sharedDayViewMock.mockResolvedValue(view(over));
    expect((await head()).robots).toEqual({ index: false, follow: false });
  });

  it("gives every miss the one generic card, and reads nothing for a segment with no id", async () => {
    sharedDayViewMock.mockResolvedValue(null);

    const unreadable = await head(`castle-and-canals-${DAY_ID}`);
    const junk = await head("not-a-day");

    expect(unreadable).toEqual(junk);
    expect(ogImageUrls(junk)).toEqual([PLAYBOOKS_IMAGE, SITE_IMAGE]);
    expect(junk.title).toBe("A playbook");
    expect(sharedDayViewMock).toHaveBeenCalledTimes(1);
  });
});

describe("/playbooks/profile/<id> metadata", () => {
  // Copilot, PR #293: the one playbook page whose mapping had no test.
  it("points og:image at the profile's card, asking its meta, keeping the page's own tab title", async () => {
    const fetchMock = stubMeta(Response.json({ title: "Traveler a1b2c3's playbooks", description: "3 playbooks" }));

    const metadata = await profileMetadata({ params: Promise.resolve({ userId: "dev-alice" }) });

    expect(ogImageUrls(metadata)).toEqual(["/api/og/playbooks/profile/dev-alice", SITE_IMAGE]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/og\/playbooks\/profile\/dev-alice\/meta$/);
    expect(metadata.openGraph?.title).toBe("Traveler a1b2c3's playbooks");
    expect(metadata.title).toBe("A traveler's playbooks");
    // Out of the index but followed, on its own path. Asserted here because a
    // preview's site-wide noindex hides the route's own value from e2e (Copilot, PR #295).
    expect(metadata.robots).toEqual(NOINDEX_FOLLOW);
    expect(metadata.alternates?.canonical).toBe("/playbooks/profile/dev-alice");
  });

  it("decodes the id as the page body does, then encodes it into one path segment", async () => {
    stubMeta(Response.json({ title: "x", description: "y" }));

    const metadata = await profileMetadata({ params: Promise.resolve({ userId: "a%2Fb" }) });

    expect(ogImageUrls(metadata)[0]).toBe("/api/og/playbooks/profile/a%2Fb");
  });

  it("falls back to the static Playbooks card when the lookup fails", async () => {
    stubMeta(new Error("connection refused"));

    const metadata = await profileMetadata({ params: Promise.resolve({ userId: "dev-alice" }) });

    expect(ogImageUrls(metadata)).toEqual([PLAYBOOKS_IMAGE, SITE_IMAGE]);
    expect(metadata.title).toBe("A traveler's playbooks");
  });
});

describe("/playbooks/board metadata", () => {
  it("points og:image at the board's static card", () => {
    expect(ogImageUrls(boardMetadata)).toEqual([`${PLAYBOOKS_IMAGE}?board=1`, SITE_IMAGE]);
    expect(boardMetadata.openGraph?.title).toBe("Who shares the most");
    expect(boardMetadata.robots).toEqual(NOINDEX_FOLLOW);
    expect(boardMetadata.alternates?.canonical).toBe("/playbooks/board");
  });
});
