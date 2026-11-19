import { describe, expect, it, vi } from "vitest";
import {
  REWARM_MS,
  WARM_CONCURRENCY,
  WARM_USER_AGENT,
  sitemapPaths,
  startPublicPageWarmer,
  warmPublicPages,
  type WarmerDeps,
} from "./warmPublicPages";

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://caesura.today/</loc></url>
<url><loc>https://caesura.today/playbooks</loc></url>
<url><loc>https://caesura.today/playbooks/day/kyoto-a1</loc><lastmod>2026-11-01T00:00:00.000Z</lastmod></url>
<url><loc>https://caesura.today/playbooks/day/kyoto-a1</loc></url>
<url><loc>https://caesura.today/playbooks/city/kyoto?a=1&amp;b=2</loc></url>
<url><loc>not a url</loc></url>
</urlset>`;

const BASE = "http://127.0.0.1:3000";

/** A fetch that answers the sitemap, then each page by `pages[path]` (a status, or "throw"). */
function fakeFetch(pages: Record<string, number | "throw"> = {}, sitemapStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { pathname, search } = new URL(url);
    if (pathname === "/sitemap.xml") return new Response(SITEMAP, { status: sitemapStatus });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    const answer = pages[`${pathname}${search}`] ?? 200;
    if (answer === "throw") throw new Error("connection reset");
    return new Response("<html></html>", { status: answer });
  });
  return { impl: impl as unknown as typeof fetch, calls, maxInFlight: () => maxInFlight };
}

describe("sitemapPaths", () => {
  it("lists each page once as a path with its query, dropping the origin and any loc that is not a URL", () => {
    expect(sitemapPaths(SITEMAP)).toEqual([
      "/",
      "/playbooks",
      "/playbooks/day/kyoto-a1",
      "/playbooks/city/kyoto?a=1&b=2",
    ]);
  });
});

describe("warmPublicPages", () => {
  it("reads every page the sitemap lists from this server, signed out, at most two at a time", async () => {
    const fetch = fakeFetch();
    const result = await warmPublicPages(BASE, fetch.impl);

    expect(fetch.calls.map((c) => c.url)).toEqual([
      `${BASE}/sitemap.xml`,
      `${BASE}/`,
      `${BASE}/playbooks`,
      `${BASE}/playbooks/day/kyoto-a1`,
      `${BASE}/playbooks/city/kyoto?a=1&b=2`,
    ]);
    for (const { init } of fetch.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("cookie")).toBeNull();
      expect(headers.get("user-agent")).toBe(WARM_USER_AGENT);
      expect(init?.redirect).toBe("manual");
    }
    expect(fetch.maxInFlight()).toBe(WARM_CONCURRENCY);
    expect(result).toMatchObject({ pages: 4, ok: 4, failed: 0 });
  });

  it("counts a page that errors or answers 4xx/5xx as failed and still reads the rest", async () => {
    const fetch = fakeFetch({ "/playbooks": 500, "/playbooks/day/kyoto-a1": "throw", "/": 308 });
    const result = await warmPublicPages(BASE, fetch.impl);
    expect(fetch.calls).toHaveLength(5);
    expect(result).toMatchObject({ pages: 4, ok: 2, failed: 2 });
  });

  it("rejects when the sitemap itself fails, reading no page", async () => {
    const fetch = fakeFetch({}, 503);
    await expect(warmPublicPages(BASE, fetch.impl)).rejects.toThrow("sitemap answered 503");
    expect(fetch.calls).toHaveLength(1);
  });
});

describe("startPublicPageWarmer", () => {
  const deps = (over: Partial<WarmerDeps> & { health?: number[] } = {}) => {
    const health = [...(over.health ?? [200])];
    const pages = fakeFetch();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/api/health")) {
        const status = health.length > 1 ? health.shift()! : health[0]!;
        return new Response("{}", { status });
      }
      return pages.impl(input, init);
    }) as unknown as typeof globalThis.fetch;
    const every = vi.fn();
    const log = vi.fn();
    return {
      deps: {
        env: () => "production",
        port: "3000",
        fetch,
        sleep: async () => {},
        every,
        log,
        ...over,
      } satisfies WarmerDeps,
      pages,
      every,
      log,
    };
  };

  it("does nothing outside production", () => {
    for (const env of [undefined, "preview", "staging"]) {
      const { deps: d, pages, every } = deps({ env: () => env });
      expect(startPublicPageWarmer(d)).toBeNull();
      expect(d.fetch).not.toHaveBeenCalled();
      expect(pages.calls).toHaveLength(0);
      expect(every).not.toHaveBeenCalled();
    }
  });

  it("waits for the health check, warms every page on this server's port, then runs again a day later", async () => {
    const { deps: d, pages, every, log } = deps({ health: [503, 503, 200], port: "4100" });
    await startPublicPageWarmer(d);
    expect(vi.mocked(d.fetch).mock.calls.filter(([url]) => String(url).endsWith("/api/health"))).toHaveLength(3);
    expect(pages.calls.map((c) => c.url)).toEqual([
      "http://127.0.0.1:4100/sitemap.xml",
      "http://127.0.0.1:4100/",
      "http://127.0.0.1:4100/playbooks",
      "http://127.0.0.1:4100/playbooks/day/kyoto-a1",
      "http://127.0.0.1:4100/playbooks/city/kyoto?a=1&b=2",
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[warm-up\] read 4 of 4 public pages in \d+ ms \(0 failed\)$/));
    expect(every).toHaveBeenCalledWith(expect.any(Function), REWARM_MS);
  });

  it("skips this start's warm-up when the server never answers, and still schedules the next", async () => {
    const { deps: d, pages, every, log } = deps({ health: [503] });
    await startPublicPageWarmer(d);
    expect(pages.calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith("[warm-up] skipped: the server never answered its health check");
    expect(every).toHaveBeenCalledWith(expect.any(Function), REWARM_MS);
  });

  it("logs a failed sitemap instead of rejecting", async () => {
    const { deps: d, log } = deps();
    const failing = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/api/health") ? new Response("{}") : new Response("", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(startPublicPageWarmer({ ...d, fetch: failing })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[warm-up] skipped: sitemap answered 500");
  });
});
