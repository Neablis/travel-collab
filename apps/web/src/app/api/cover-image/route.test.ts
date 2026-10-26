import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteImageRefused } from "@/server/external/remoteImage/guard";
import { coverProxySrc } from "@/server/coverProxy";

// The proxy route (ADR-081 item 3): the signature is checked before anything
// is fetched, a refusal is a 502 the browser shows as the no-cover state, and
// an image comes back from our origin with long cache headers. The fetcher
// itself, and what it refuses, is `fetchImage.test.ts`'s.

const fetchRemoteImage = vi.fn();
vi.mock("@/server/external/remoteImage/fetchImage", () => ({ fetchRemoteImage }));

const { GET } = await import("./route");

const URL_A = "https://cdn.example.com/harbour.jpg";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const get = (path: string) => GET(new Request(`https://caesura.test${path}`, { headers: { cookie: "session=secret" } }));

beforeEach(() => {
  vi.stubEnv("COVER_PROXY_SECRET", "route-test-key");
  // An image is there to serve, so a 403 below is the signature's doing.
  fetchRemoteImage.mockResolvedValue({ contentType: "image/png", bytes: PNG });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fetchRemoteImage.mockReset();
});

describe("GET /api/cover-image", () => {
  it.each([
    ["no signature", `/api/cover-image?u=${encodeURIComponent(URL_A)}`],
    ["a signature for another URL", coverProxySrc("https://cdn.example.com/other.jpg").replace(/u=[^&]*/, `u=${encodeURIComponent(URL_A)}`)],
    ["a forged signature", `/api/cover-image?u=${encodeURIComponent(URL_A)}&s=${"A".repeat(43)}`],
    ["no URL", "/api/cover-image?s=abc"],
  ])("answers 403 on %s, and fetches nothing", async (_what, path) => {
    const response = await get(path);
    expect(response.status).toBe(403);
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  // The CDN keys on the whole query string, so a second spelling of a
  // signed path is its own cache entry; the signature still binds the URL,
  // so a respelling serves, while a parameter appended or duplicated is
  // refused: the query must name exactly `u` and `s`.
  it.each([
    ["a parameter appended", (path: string) => `${path}&x=1`],
    ["a parameter duplicated", (path: string) => `${path}&u=${encodeURIComponent(URL_A)}`],
  ])("answers 403 on a signed path with %s, and fetches nothing", async (_what, respell) => {
    const response = await get(respell(coverProxySrc(URL_A)));
    expect(response.status).toBe(403);
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  it("serves a signed path whose URL is spelled with different percent-encoding", async () => {
    const response = await get(coverProxySrc(URL_A).replace("harbour", "h%61rbour"));
    expect(response.status).toBe(200);
    expect(fetchRemoteImage).toHaveBeenCalledWith(URL_A);
  });

  // Production, 2026-10-26: a layer in front of the route normalized the
  // parentheses in a cover URL, so the minted spelling never arrived and
  // the cover showed as none. Either spelling of the same pair serves.
  it.each([
    ["the minted spelling", (path: string) => path],
    ["the parentheses percent-encoded", (path: string) => path.replace("(11732502696)", "%2811732502696%29")],
  ])("serves a signed paren URL requested with %s", async (_what, respell) => {
    const url = "https://upload.wikimedia.org/wikipedia/commons/6/61/Slovenia_-_Lago_di_Bled_(11732502696).jpg";
    const response = await get(respell(coverProxySrc(url)));
    expect(response.status).toBe(200);
    expect(fetchRemoteImage).toHaveBeenCalledWith(url);
  });

  // `encodeURIComponent` leaves `'` raw and URL parsing escapes it, so a path
  // minted unparsed is never the spelling the route sees.
  it("serves a signed URL whose path the URL parser rewrites", async () => {
    const url = "https://cdn.example.com/o'neil.jpg";
    const response = await get(coverProxySrc(url));
    expect(response.status).toBe(200);
    expect(fetchRemoteImage).toHaveBeenCalledWith(url);
  });

  it("answers 502 when the fetcher refuses the URL", async () => {
    fetchRemoteImage.mockRejectedValue(new RemoteImageRefused("private-address"));
    const response = await get(coverProxySrc(URL_A));
    expect(response.status).toBe(502);
    expect(fetchRemoteImage).toHaveBeenCalledWith(URL_A);
  });

  it("serves a signed URL's image from our origin, typed by the fetcher, not sniffed, and inert as a document", async () => {
    const response = await get(coverProxySrc(URL_A));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cache-control")).toMatch(/public, max-age=\d{5,}/);
    expect(response.headers.get("cdn-cache-control")).toMatch(/public, max-age=\d{6,}/);
    // Only the URL reaches the fetcher: none of the viewer's request does.
    expect(fetchRemoteImage).toHaveBeenCalledWith(URL_A);
  });
});
