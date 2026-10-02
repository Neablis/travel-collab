import { afterEach, describe, expect, it, vi } from "vitest";
import { NOINDEX, pageMetadata, siteRobots } from "./siteMetadata";

describe("pageMetadata", () => {
  it("states the twitter title and description, suffix-free", () => {
    const meta = pageMetadata({ title: "Developers", description: "The API." });
    expect(meta.twitter).toEqual({ card: "summary_large_image", title: "Developers", description: "The API." });
  });

  it("gives the card its own title when one is passed, and leaves the tab's alone", () => {
    const meta = pageMetadata({ title: "A slow day · Kyoto", cardTitle: "A slow day", description: "B" });
    expect(meta.title).toBe("A slow day · Kyoto");
    expect(meta.openGraph?.title).toBe("A slow day");
    expect(meta.twitter?.title).toBe("A slow day");
  });

  it("sets the canonical and og:url only when asked", () => {
    expect(pageMetadata({ title: "A", description: "B" }).alternates).toBeUndefined();
    const meta = pageMetadata({ title: "A", description: "B", canonical: "/playbooks" });
    expect(meta.alternates).toEqual({ canonical: "/playbooks" });
    expect(meta.openGraph?.url).toBe("/playbooks");
  });

  it("passes robots through", () => {
    expect(pageMetadata({ title: "A", description: "B", robots: NOINDEX }).robots).toEqual({ index: false, follow: false });
  });
});

describe("siteRobots", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("leaves production indexable", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(siteRobots()).toBeUndefined();
  });

  it("keeps every other deployment out of the index", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(siteRobots()).toEqual({ index: false, follow: false });
    vi.stubEnv("VERCEL_ENV", "");
    expect(siteRobots()).toEqual({ index: false, follow: false });
  });
});
