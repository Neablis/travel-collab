import { describe, expect, it } from "vitest";
import { CoverCandidate, SetCoverPositionBody, TripCover, TripSummary, UNSPLASH_HOME, unsplashCreditHref } from "../src/index.ts";

describe("unsplashCreditHref", () => {
  // Unsplash's guidelines: every credit link carries the registered app name
  // as utm_source, and utm_medium=referral.
  it("adds the referral parameters to a photographer's profile and a photo page", () => {
    expect(unsplashCreditHref("https://unsplash.com/@annie")).toBe(
      "https://unsplash.com/@annie?utm_source=caesura&utm_medium=referral",
    );
    expect(unsplashCreditHref("https://unsplash.com/photos/abc123?foo=1")).toBe(
      "https://unsplash.com/photos/abc123?foo=1&utm_source=caesura&utm_medium=referral",
    );
    expect(unsplashCreditHref(UNSPLASH_HOME)).toBe("https://unsplash.com/?utm_source=caesura&utm_medium=referral");
  });

  it("replaces, not repeats, referral parameters the URL already carries", () => {
    expect(unsplashCreditHref("https://unsplash.com/@annie?utm_source=other&utm_medium=x")).toBe(
      "https://unsplash.com/@annie?utm_source=caesura&utm_medium=referral",
    );
  });

  // A stored credit is shown to everyone on the trip: whatever is not an
  // https unsplash.com URL must not become a link anywhere.
  it.each(["javascript:alert(1)", "http://unsplash.com/@annie", "https://unsplash.com.evil.test/@annie", "https://unsplash.com@evil.test/", "not a url", ""])(
    "answers Unsplash's home page for %j",
    (url) => {
      expect(unsplashCreditHref(url)).toBe("https://unsplash.com/?utm_source=caesura&utm_medium=referral");
    },
  );
});

describe("CoverCandidate", () => {
  const candidate = {
    id: "abc123",
    urls: { raw: "https://images.unsplash.com/a", regular: "https://images.unsplash.com/a?w=1080", small: "https://images.unsplash.com/a?w=400" },
    alt: null,
    photographerName: "Annie Spratt",
    photographerUrl: "https://unsplash.com/@annie",
    photoPageUrl: "https://unsplash.com/photos/abc123",
    downloadLocation: "https://api.unsplash.com/photos/abc123/download",
  };

  it("parses a search result and refuses one with no photographer to credit", () => {
    expect(CoverCandidate.parse(candidate)).toEqual(candidate);
    expect(CoverCandidate.safeParse({ ...candidate, photographerName: "" }).success).toBe(false);
  });
});

describe("TripSummary.cover", () => {
  it("parses a summary from before covers as having none", () => {
    const summary = {
      tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
      name: "Rome 2027",
      status: "active",
      members: [{ userId: "dev-alice", role: "owner" }],
      createdAt: "2026-07-08T12:00:00.000Z",
    };
    expect(TripSummary.parse(summary).cover).toBeNull();
  });
});

describe("TripCover", () => {
  const unsplash = {
    source: "unsplash",
    unsplashId: "abc123",
    urls: { raw: "https://images.unsplash.com/a", regular: "https://images.unsplash.com/a?w=1080", small: "https://images.unsplash.com/a?w=400" },
    alt: null,
    photographerName: "Annie Spratt",
    photographerUrl: "https://unsplash.com/@annie",
    photoPageUrl: "https://unsplash.com/photos/abc123",
  };

  // Every cover stored before M49 was framed at the centre (decision 9).
  it("reads a cover with no position as framed at the centre", () => {
    expect(TripCover.parse(unsplash)).toEqual({ ...unsplash, position: 50 });
  });

  it.each([-1, 101, 30.5])("refuses a position of %j", (position) => {
    expect(TripCover.safeParse({ ...unsplash, position }).success).toBe(false);
    expect(SetCoverPositionBody.safeParse({ position }).success).toBe(false);
  });

  it("parses a URL cover with nothing but its URL, and refuses one without it", () => {
    expect(TripCover.parse({ source: "url", url: "https://example.com/a.jpg" })).toEqual({
      source: "url",
      url: "https://example.com/a.jpg",
      alt: null,
      credit: null,
      position: 50,
    });
    expect(TripCover.safeParse({ source: "url", alt: "A harbour" }).success).toBe(false);
  });
});
