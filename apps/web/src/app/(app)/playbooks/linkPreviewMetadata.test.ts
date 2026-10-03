import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { NOINDEX_FOLLOW } from "@/lib/siteMetadata";
import { metadata as boardMetadata } from "./board/page";
import { generateMetadata as dayMetadata } from "./day/[savedDayId]/page";
import { generateMetadata as discoverMetadata } from "./page";
import { generateMetadata as profileMetadata } from "./profile/[userId]/page";

// Spec 2026-10-02 §2.7, "Link previews": which card each Playbooks page points
// og:image at. The `meta` routes are stubbed — what they answer is
// `app/api/og/playbooks/routes.int.test.ts`.

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

describe("/playbooks/day/<id> metadata", () => {
  it("points og:image at the day's card, and names the tab for the day", async () => {
    stubMeta(Response.json({ title: "Castle and canals", description: "Osaka · 1 stop" }));

    const metadata = await dayMetadata({ params: Promise.resolve({ savedDayId: "d-1" }) });

    expect(ogImageUrls(metadata)).toEqual(["/api/og/playbooks/day/d-1", SITE_IMAGE]);
    expect(metadata.openGraph?.title).toBe("Castle and canals");
    expect(metadata.title).toBe("Castle and canals");
    // The clean path: `?from=` and friends are never part of it (Copilot, PR #295).
    expect(metadata.alternates?.canonical).toBe("/playbooks/day/d-1");
  });

  it("keeps the generic tab title and Playbooks card when the lookup fails", async () => {
    stubMeta(new Error("connection refused"));

    const metadata = await dayMetadata({ params: Promise.resolve({ savedDayId: "d-1" }) });

    expect(ogImageUrls(metadata)).toEqual([PLAYBOOKS_IMAGE, SITE_IMAGE]);
    expect(metadata.title).toBe("A playbook");
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
