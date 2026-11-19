import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_TRIPS } from "@/lib/demoTrip";
import robots, * as route from "./robots";

/**
 * Whether a crawler that follows RFC 9309 may fetch `path` under these rules:
 * the longest matching rule wins, `*` matches any run of characters, and an
 * `Allow` beats a `Disallow` of the same length (Google's reading).
 */
function crawlable(path: string, allow: readonly string[], disallow: readonly string[]): boolean {
  const pattern = (rule: string) => rule.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  const longest = (rules: readonly string[]) =>
    Math.max(-1, ...rules.filter((rule) => new RegExp(`^${pattern(rule)}`).test(path)).map((rule) => rule.length));
  return longest(allow) >= longest(disallow);
}

/** The one rule group's allow and disallow lists, each as a list. */
function lists() {
  const { rules } = robots();
  const only = Array.isArray(rules) ? rules[0]! : rules;
  const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
  return { allow: list(only.allow), disallow: list(only.disallow) };
}

describe("robots.txt", () => {
  it("allows the site and the public Playbooks cards, and keeps the rest of /api/ out", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0]! : rules;
    expect(rule.userAgent).toBe("*");
    // The longer path wins (RFC 9309), so a card under /api/og/playbooks is
    // fetchable while /api/og/invite and /api/og/referral, keyed by tokens, are not.
    expect(rule.allow).toEqual(["/", "/api/og/playbooks", ...route.RENDER_FETCHES]);
    expect(rule.disallow).toContain("/api/");
  });

  // Google renders a sitemap page with its scripts and refuses any fetch of
  // theirs this file disallows. The demo boards and the API reference then
  // drew an error or nothing, and Search Console reported new soft 404s on
  // sitemap pages (2026-11-19).
  it("lets a crawler's renderer read what the demo boards and the API reference draw from", () => {
    const { allow, disallow } = lists();
    for (const { tripId } of DEMO_TRIPS) {
      const reads = [`/api/trips/${tripId}`, `/api/trips/${tripId}/history`, `/api/trips/${tripId}/access`, `/api/v1/trips/${tripId}/guests`];
      for (const read of reads) expect(crawlable(read, allow, disallow), read).toBe(true);
    }
    expect(crawlable("/api/v1/openapi", allow, disallow)).toBe(true);
  });

  it("keeps every other trip, an account and an invite card out of reach", () => {
    const { allow, disallow } = lists();
    const other = "0b1c2d3e-0000-4000-8000-000000000001";
    for (const read of [`/api/trips/${other}`, `/api/v1/trips/${other}/guests`, "/api/trips", "/api/v1/account", "/api/og/invite/abc"]) {
      expect(crawlable(read, allow, disallow), read).toBe(false);
    }
    expect(crawlable("/api/og/playbooks/city/Rome", allow, disallow)).toBe(true);
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
