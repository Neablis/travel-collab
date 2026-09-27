import { afterEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { generateMetadata as inviteMetadata } from "./invite/[token]/page";
import { generateMetadata as signupMetadata } from "./signup/page";

// Spec 2026-09-27 §2.3, "Metadata": the two shared links point og:image at
// their own card and take og:title from the card's `meta` route, and `/signup`
// without a code keeps the site card. The `meta` route itself is stubbed here —
// what it answers is `app/api/og/routes.int.test.ts`.

const SITE_IMAGE = "/opengraph-image.png";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/invite/<token> metadata", () => {
  it("points og:image at the invite card, with the site card after it", async () => {
    const fetchMock = stubMeta(Response.json({ title: "Dana invited you to plan Japan", description: "3 days" }));

    const metadata = await inviteMetadata({ params: Promise.resolve({ token: "tok_123" }) });

    expect(ogImageUrls(metadata)).toEqual(["/api/og/invite/tok_123", SITE_IMAGE]);
    expect(metadata.openGraph?.title).toBe("Dana invited you to plan Japan");
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/og\/invite\/tok_123\/meta$/);
  });

  it("keeps the page's plain metadata when the lookup fails", async () => {
    stubMeta(new Error("connection refused"));

    expect(await inviteMetadata({ params: Promise.resolve({ token: "tok_123" }) })).toEqual({
      title: "You're invited",
    });
  });
});

describe("/signup metadata", () => {
  it("points og:image at the referral card when ?code= names a referrer", async () => {
    stubMeta(Response.json({ title: "Dana invited you to Caesura", description: "Trips, planned together" }));

    const metadata = await signupMetadata({ searchParams: Promise.resolve({ code: "ABCDEFGHJK" }) });

    expect(ogImageUrls(metadata)).toEqual(["/api/og/referral/ABCDEFGHJK", SITE_IMAGE]);
    expect(metadata.openGraph?.title).toBe("Dana invited you to Caesura");
  });

  it("keeps the site card when the code names nobody", async () => {
    stubMeta(Response.json({ error: "not-found" }, { status: 404 }));

    const metadata = await signupMetadata({ searchParams: Promise.resolve({ code: "NOPE" }) });

    expect(ogImageUrls(metadata)).toEqual([SITE_IMAGE]);
  });

  it("keeps the site card, and asks nothing, without a code", async () => {
    const fetchMock = stubMeta(new Error("must not be called"));

    const metadata = await signupMetadata({ searchParams: Promise.resolve({}) });

    expect(ogImageUrls(metadata)).toEqual([SITE_IMAGE]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
