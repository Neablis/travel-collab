import { afterEach, describe, expect, it, vi } from "vitest";
import robots, * as route from "./robots";

describe("robots.txt", () => {
  it("allows the site and the public Playbooks cards, and keeps the rest of /api/ out", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    expect(rule.userAgent).toBe("*");
    // The longer path wins (RFC 9309), so a card under /api/og/playbooks is
    // fetchable while /api/og/invite and /api/og/referral, keyed by tokens, are not.
    expect(rule.allow).toEqual(["/", "/api/og/playbooks"]);
    expect(rule.disallow).toContain("/api/");
  });

  // Rendered per request and never indexed: crawling them only spent CPU
  // (2026-11-06).
  it("keeps crawlers off profiles, the board and back-link copies", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    expect(rule.disallow).toEqual(["/api/", "/playbooks/profile/", "/playbooks/board", "/*?*from="]);
  });

  // The sitemap's own pages must stay crawlable: nothing it lists may sit
  // under a skipped prefix.
  it("skips nothing a sitemap entry can be", () => {
    for (const path of ["/playbooks", "/playbooks/city/kyoto", "/playbooks/day/a-b", "/playbooks/length/weekend"]) {
      for (const skipped of ["/playbooks/profile/", "/playbooks/board"]) expect(path.startsWith(skipped)).toBe(false);
    }
  });

  // Production said `Sitemap: http://localhost:3001/sitemap.xml` (2026-11-09):
  // a static robots.txt is written by `next build`, and the Coolify build had
  // no PUBLIC_ORIGIN. Rendered per request, it names the origin the running
  // server was given.
  describe("the sitemap line", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("is rendered per request, not frozen at build time", () => {
      expect(route.dynamic).toBe("force-dynamic");
    });

    it("names the configured public origin", () => {
      vi.stubEnv("PUBLIC_ORIGIN", "https://caesura.today");
      expect(robots().sitemap).toBe("https://caesura.today/sitemap.xml");
    });
  });
});
