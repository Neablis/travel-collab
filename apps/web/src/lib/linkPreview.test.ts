import { afterEach, describe, expect, it, vi } from "vitest";
import { linkPreviewMetadata } from "./linkPreview";

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("linkPreviewMetadata", () => {
  // Every render of an invite, referral or profile page used to wait on a
  // fresh request to its own origin before the <head> could stream.
  it("lets Next reuse the card's lookup for an hour", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ title: "Ana invited you", description: "Kyoto in spring" })));
    vi.stubGlobal("fetch", fetchMock);
    const meta = await linkPreviewMetadata("/api/og/invite/tok", { title: "You're invited" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ next: { revalidate: 3600 } });
    expect(meta.openGraph?.title).toBe("Ana invited you");
  });

  it("falls back when the lookup does not answer 200", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const fallback = { title: "You're invited" };
    expect(await linkPreviewMetadata("/api/og/invite/tok", fallback)).toBe(fallback);
  });
});
