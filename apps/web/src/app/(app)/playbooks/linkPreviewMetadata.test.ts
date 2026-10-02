import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { metadata as boardMetadata } from "./board/page";
import { generateMetadata as dayMetadata } from "./day/[savedDayId]/page";
import { generateMetadata as discoverMetadata } from "./page";

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
  it("points og:image at the day's card, keeping the page's own tab title", async () => {
    stubMeta(Response.json({ title: "Castle and canals", description: "Osaka · 1 stop" }));

    const metadata = await dayMetadata({ params: Promise.resolve({ savedDayId: "d-1" }) });

    expect(ogImageUrls(metadata)).toEqual(["/api/og/playbooks/day/d-1", SITE_IMAGE]);
    expect(metadata.openGraph?.title).toBe("Castle and canals");
    expect(metadata.title).toBe("A playbook");
  });
});

describe("/playbooks/board metadata", () => {
  it("points og:image at the board's static card", () => {
    expect(ogImageUrls(boardMetadata)).toEqual([`${PLAYBOOKS_IMAGE}?board=1`, SITE_IMAGE]);
    expect(boardMetadata.openGraph?.title).toBe("Who shares the most");
  });
});
