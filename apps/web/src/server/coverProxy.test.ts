import { afterEach, describe, expect, it, vi } from "vitest";
import { coverProxySrc, coverProxySrcFits, signCoverUrl, verifyCoverUrl } from "./coverProxy";

// The signature that keeps `/api/cover-image` from being an open proxy
// (ADR-081 item 3): it serves a URL only with the HMAC the server minted when
// it serialized a cover holding that URL.

afterEach(() => vi.unstubAllEnvs());

const URL_A = "https://cdn.example.com/harbour.jpg";

describe("cover proxy signatures", () => {
  it("verifies the signature it minted, for that URL only", () => {
    vi.stubEnv("COVER_PROXY_SECRET", "k1");
    const signature = signCoverUrl(URL_A);
    expect(verifyCoverUrl(URL_A, signature)).toBe(true);
    expect(verifyCoverUrl("https://cdn.example.com/other.jpg", signature)).toBe(false);
    expect(verifyCoverUrl(URL_A, `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`)).toBe(false);
    expect(verifyCoverUrl(URL_A, "")).toBe(false);
  });

  it("refuses a signature minted under another key", () => {
    vi.stubEnv("COVER_PROXY_SECRET", "k1");
    const signature = signCoverUrl(URL_A);
    vi.stubEnv("COVER_PROXY_SECRET", "k2");
    expect(verifyCoverUrl(URL_A, signature)).toBe(false);
  });

  it("signs with a development key outside production, and throws without one in production", () => {
    vi.stubEnv("COVER_PROXY_SECRET", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(verifyCoverUrl(URL_A, signCoverUrl(URL_A))).toBe(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => signCoverUrl(URL_A)).toThrow(/COVER_PROXY_SECRET is not set/);
  });

  it("signs with COVER_PROXY_SECRET wherever it is set, a preview included", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("COVER_PROXY_SECRET", "");
    const devKeySignature = signCoverUrl(URL_A);
    vi.stubEnv("COVER_PROXY_SECRET", "preview-key");
    expect(signCoverUrl(URL_A)).not.toBe(devKeySignature);
  });

  it("mints a same-origin path that carries the URL and its signature", () => {
    vi.stubEnv("COVER_PROXY_SECRET", "k1");
    const url = "https://cdn.example.com/a b.jpg?w=1&h=2#frag";
    const src = new URL(coverProxySrc(url), "https://caesura.test");
    expect(src.origin).toBe("https://caesura.test");
    expect(src.pathname).toBe("/api/cover-image");
    expect(src.searchParams.get("u")).toBe(url);
    expect(verifyCoverUrl(url, src.searchParams.get("s")!)).toBe(true);
  });

  it("says a URL fits exactly when its minted path is within the contract's 2,048 characters", () => {
    vi.stubEnv("COVER_PROXY_SECRET", "k1");
    const seen = new Set<boolean>();
    // Across the boundary, with a `/` (encoded as three characters) on every other step.
    for (let length = 950; length < 1000; length += 1) {
      const url = `https://cdn.example.com/${"a/".repeat(length).slice(0, length)}`;
      const fits = coverProxySrc(url).length <= 2048;
      expect(coverProxySrcFits(url), String(length)).toBe(fits);
      seen.add(fits);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });
});
