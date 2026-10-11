import { beforeEach, describe, expect, it, vi } from "vitest";

const sitemapDays = vi.fn();
const publishedTagPages = vi.fn();
vi.mock("@/server/playbooks", () => ({
  sitemapDays: () => sitemapDays(),
  publishedPlaces: async () => [],
  publishedTagPages: () => publishedTagPages(),
}));

import { deploymentOrigin } from "@/lib/deploymentOrigin";
import sitemap from "./sitemap";

beforeEach(() => {
  sitemapDays.mockReset().mockResolvedValue([]);
  publishedTagPages.mockReset().mockResolvedValue([]);
});

describe("sitemap.xml", () => {
  it("lists the root among the static routes", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain(`${deploymentOrigin()}/`);
  });

  // Copilot, PR 296: nothing observed the `lastModified = publishedAt` mapping.
  it("dates a day by when it was published, and leaves an undated day undated", async () => {
    sitemapDays.mockResolvedValue([
      { savedDayId: "d-1", name: "One", publishedAt: "2026-09-08T15:47:40.864Z" },
      { savedDayId: "d-2", name: "Two", publishedAt: null },
    ]);
    const entries = await sitemap();
    expect(entries.find((e) => e.url.endsWith("d-1"))?.lastModified).toBe("2026-09-08T15:47:40.864Z");
    expect(entries.find((e) => e.url.endsWith("d-2"))).not.toHaveProperty("lastModified");
  });

  // M42 D10: a tag page, and a city's, is listed from three days up, the
  // threshold a city page is held to; a thinner one is `noindex` and left out.
  it("lists a tag page and a city×tag page only from three days up", async () => {
    const kyoto = { slug: "kyoto", name: "Kyoto", cities: ["Kyoto"] };
    publishedTagPages.mockResolvedValue([
      { tag: "nightlife", city: null, days: 3 },
      { tag: "beach", city: null, days: 2 },
      { tag: "meal", city: kyoto, days: 3 },
      { tag: "museum", city: kyoto, days: 2 },
    ]);
    const tagged = (await sitemap())
      .map((entry) => new URL(entry.url).pathname)
      .filter((path) => path.startsWith("/playbooks/tag/") || path.startsWith("/playbooks/city/"));
    expect(tagged).toEqual(["/playbooks/tag/nightlife", "/playbooks/city/kyoto/meal"]);
  });
});
