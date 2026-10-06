import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineCoverPhotos } from "./offline";
import { UpstreamError } from "./ports";
import { createUnsplash } from "./unsplash";

// The adapter against a stubbed `fetch`: no test calls Unsplash. The photo
// below is the shape Unsplash's search documents, trimmed to what is read.

afterEach(() => vi.unstubAllGlobals());

const PHOTO = {
  id: "Dwu85P9SOIk",
  alt_description: "white and gray concrete building near body of water",
  urls: {
    raw: "https://images.unsplash.com/photo-1?ixid=abc",
    regular: "https://images.unsplash.com/photo-1?ixid=abc&w=1080",
    small: "https://images.unsplash.com/photo-1?ixid=abc&w=400",
  },
  links: {
    html: "https://unsplash.com/photos/Dwu85P9SOIk",
    download_location: "https://api.unsplash.com/photos/Dwu85P9SOIk/download?ixid=abc",
  },
  user: { name: "Annie Spratt", links: { html: "https://unsplash.com/@anniespratt" } },
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("the Unsplash adapter", () => {
  it("asks for one filtered, landscape page with the Access Key in a header, never the URL", async () => {
    const fetchMock = stubFetch(200, { results: [] });
    await createUnsplash("KEY123").search("Lisbon tiles", 2);

    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.unsplash.com/search/photos");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "Lisbon tiles",
      page: "2",
      per_page: "12",
      content_filter: "high",
      orientation: "landscape",
    });
    expect(String(input)).not.toContain("KEY123");
    expect(init?.headers).toEqual({ Authorization: "Client-ID KEY123", "Accept-Version": "v1" });
  });

  it("maps a result to a candidate: three sizes, alt text, both credit links and the download location", async () => {
    stubFetch(200, { results: [PHOTO] });
    expect(await createUnsplash("KEY123").search("Lisbon", 1)).toEqual([
      {
        id: "Dwu85P9SOIk",
        urls: PHOTO.urls,
        alt: "white and gray concrete building near body of water",
        photographerName: "Annie Spratt",
        photographerUrl: "https://unsplash.com/@anniespratt",
        photoPageUrl: "https://unsplash.com/photos/Dwu85P9SOIk",
        downloadLocation: "https://api.unsplash.com/photos/Dwu85P9SOIk/download?ixid=abc",
      },
    ]);
  });

  it("keeps a photo with no alt text, and drops one it could not credit or host", async () => {
    stubFetch(200, {
      results: [
        { ...PHOTO, id: "no-alt", alt_description: null },
        { ...PHOTO, id: "no-name", user: { links: PHOTO.user.links } },
        { ...PHOTO, id: "off-cdn", urls: { ...PHOTO.urls, small: "https://elsewhere.test/photo-1" } },
      ],
    });
    const results = await createUnsplash("KEY123").search("Lisbon", 1);
    expect(results.map((r) => [r.id, r.alt])).toEqual([["no-alt", null]]);
  });

  it("throws UpstreamError for a refusal, a timeout and a body that is not JSON", async () => {
    stubFetch(403, { errors: ["Rate Limit Exceeded"] });
    await expect(createUnsplash("KEY123").search("Lisbon", 1)).rejects.toMatchObject({ name: "UpstreamError", status: 403 });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))));
    await expect(createUnsplash("KEY123").search("Lisbon", 1)).rejects.toBeInstanceOf(UpstreamError);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(createUnsplash("KEY123").search("Lisbon", 1)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("pings the download location as given, query string and key included", async () => {
    const fetchMock = stubFetch(200, { url: "https://images.unsplash.com/photo-1" });
    await createUnsplash("KEY123").trackDownload(PHOTO.links.download_location);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(String(input)).toBe("https://api.unsplash.com/photos/Dwu85P9SOIk/download?ixid=abc");
    expect(init?.headers).toEqual({ Authorization: "Client-ID KEY123", "Accept-Version": "v1" });
  });

  // The key goes wherever the location points, so it must point at Unsplash.
  it("refuses to send the key to a download location off api.unsplash.com", async () => {
    const fetchMock = stubFetch(200, {});
    await expect(createUnsplash("KEY123").trackDownload("https://attacker.test/collect")).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("owns only a candidate on its CDN, its API and unsplash.com", async () => {
    stubFetch(200, { results: [PHOTO] });
    const unsplash = createUnsplash("KEY123");
    const [candidate] = await unsplash.search("Lisbon", 1);
    expect(unsplash.owns(candidate!)).toBe(true);
    expect(unsplash.owns({ ...candidate!, urls: { ...candidate!.urls, regular: "http://images.unsplash.com/x" } })).toBe(false);
    expect(unsplash.owns({ ...candidate!, photographerUrl: "javascript:alert(1)" })).toBe(false);
    expect(unsplash.owns({ ...candidate!, downloadLocation: "https://attacker.test/collect" })).toBe(false);
    // The offline fake's same-origin images are not Unsplash's.
    const [offline] = await offlineCoverPhotos.search("anything", 1);
    expect(unsplash.owns(offline!)).toBe(false);
  });
});

describe("the offline cover source", () => {
  it("owns its own photos and nothing pointed elsewhere", async () => {
    const [photo] = await offlineCoverPhotos.search("anything", 1);
    expect(offlineCoverPhotos.owns(photo!)).toBe(true);
    expect(offlineCoverPhotos.owns({ ...photo!, urls: { ...photo!.urls, regular: "https://elsewhere.test/x.svg" } })).toBe(
      false,
    );
    expect(offlineCoverPhotos.owns({ ...photo!, photoPageUrl: "https://elsewhere.test/x" })).toBe(false);
    expect(await offlineCoverPhotos.search("anything", 2)).toEqual([]);
  });
});
