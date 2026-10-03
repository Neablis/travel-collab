import { beforeEach, describe, expect, it, vi } from "vitest";

const sitemapDays = vi.fn();
vi.mock("@/server/playbooks", () => ({ sitemapDays: () => sitemapDays(), publishedPlaces: async () => [] }));

import { deploymentOrigin } from "@/lib/deploymentOrigin";
import sitemap from "./sitemap";

beforeEach(() => {
  sitemapDays.mockReset().mockResolvedValue([]);
});

describe("sitemap.xml", () => {
  it("lists the root among the static routes", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain(`${deploymentOrigin()}/`);
  });

  // Copilot, PR #296: nothing observed the `lastModified = publishedAt` mapping.
  it("dates a day by when it was published, and leaves an undated day undated", async () => {
    sitemapDays.mockResolvedValue([
      { savedDayId: "d-1", name: "One", publishedAt: "2026-09-08T15:47:40.864Z" },
      { savedDayId: "d-2", name: "Two", publishedAt: null },
    ]);
    const entries = await sitemap();
    expect(entries.find((e) => e.url.endsWith("d-1"))?.lastModified).toBe("2026-09-08T15:47:40.864Z");
    expect(entries.find((e) => e.url.endsWith("d-2"))).not.toHaveProperty("lastModified");
  });
});
