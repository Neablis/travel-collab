import { describe, expect, it, vi, afterEach } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";

/**
 * The CSP is a build-time string, so nothing that runs in this repo's normal
 * lanes observes a variant of it until it is deployed and a browser refuses
 * something. These tests read the header out of `headers()` for each
 * environment. Since M59 the policy is the same in preview and production:
 * the Vercel Toolbar's origins are gone, and the one environment-dependent
 * origin is the self-hosted Plausible.
 */

// next.config.ts reads process.env at module scope, so each case needs a fresh
// module registry rather than a shared import.
//
// `undefined` REMOVES the variable rather than setting it to "" — those are
// different states (`process.env.VERCEL_ENV` is `undefined` vs `""`), and the
// first version of this helper conflated them, so the case named "unset" was
// really testing the empty string and nothing tested a genuinely absent
// variable at all (CodeRabbit, PR #80). Both are covered below now. The
// current `=== "preview"` gate treats them alike, which is exactly why the
// gap was invisible: it costs nothing today and would hide the regression the
// day the gate becomes a truthiness or `startsWith` check.
//
// `nodeEnv` is optional because Vitest runs with NODE_ENV=test, which
// next.config.ts's `isDev` (`!== "production"`) reads as development. So every
// case that does not pass it is looking at the DEV branch of the policy — the
// preview/production pairs above compare like with like, which is why that
// never mattered to them; the dev-vs-built cases below pass it explicitly.
async function headersFor(
  vercelEnv: string | undefined,
  nodeEnv?: "production" | "development",
): Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> {
  vi.resetModules();
  vi.stubEnv("VERCEL_ENV", vercelEnv);
  if (nodeEnv) vi.stubEnv("NODE_ENV", nodeEnv);
  const { default: config } = await import("./next.config");
  return (await config.headers!()) as Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
}

async function cspFor(
  vercelEnv: string | undefined,
  nodeEnv?: "production" | "development",
): Promise<string> {
  const routes = await headersFor(vercelEnv, nodeEnv);
  const global = routes.find((r) => r.source === "/:path*");
  const csp = global?.headers.find((h) => h.key === "Content-Security-Policy");
  if (!csp) throw new Error("no Content-Security-Policy header on the global route");
  return csp.value;
}

/** Pull one directive out of the joined policy so assertions can't cross it. */
function directive(csp: string, name: string): string {
  const found = csp
    .split("; ")
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${csp}`);
  return found;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the CSP names no Vercel origin", () => {
  it.each(["preview", "production", undefined])("in %o, in a built app or the dev server", async (env) => {
    for (const nodeEnv of ["production", "development"] as const) {
      const csp = await cspFor(env, nodeEnv);
      expect(csp).not.toContain("vercel");
      expect(csp).not.toContain("pusher");
    }
  });

  it.each(["", "preview", "production", "PREVIEW", "prod"])("is the same policy whatever VERCEL_ENV is (%o)", async (value) => {
    expect(await cspFor(value, "production")).toBe(await cspFor(undefined, "production"));
  });

  it("frame-src is 'none' everywhere", async () => {
    for (const env of ["preview", "production", undefined]) {
      expect(directive(await cspFor(env), "frame-src")).toBe("frame-src 'none'");
    }
  });
});

describe("the self-hosted Plausible origin", () => {
  async function withPlausible(src: string | undefined, nodeEnv: "production" | "development" = "production") {
    vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_SRC", src);
    return cspFor(undefined, nodeEnv);
  }

  it("is allowed to load its script and receive events, by origin only, when configured", async () => {
    const csp = await withPlausible("https://stats.example.com/js/script.js");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://stats.example.com");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org https://stats.example.com");
  });

  it.each([undefined, "", "not a url"])("adds nothing when SRC is %o", async (src) => {
    expect(await withPlausible(src)).toBe(await cspFor(undefined, "production"));
  });
});

describe("Strict-Transport-Security", () => {
  const hsts = async (nodeEnv: "production" | "development") =>
    (await headersFor(undefined, nodeEnv))
      .find((r) => r.source === "/:path*")
      ?.headers.find((h) => h.key === "Strict-Transport-Security")?.value;

  // The app serves it itself now that nothing in front of it does (M59). Not in
  // dev: a browser that honours it would pin localhost to https for a year.
  it("is served by a production build, for a year", async () => {
    expect(await hsts("production")).toBe("max-age=31536000");
  });

  it("is not served by the dev server", async () => {
    expect(await hsts("development")).toBeUndefined();
  });
});

/**
 * What a response for `pathname` carries: every `headers()` entry whose source
 * matches, applied in order so a later entry's value for a key wins, which is
 * how Next applies them. Matched with Next's own matcher, so a source that
 * stops matching its path fails here rather than on a deployment.
 */
async function headersServedAt(pathname: string): Promise<Map<string, string>> {
  const served = new Map<string, string>();
  for (const route of await headersFor("production", "production")) {
    if (!getPathMatch(route.source, { removeUnnamedParams: true, strict: true })(pathname)) continue;
    for (const { key, value } of route.headers) served.set(key.toLowerCase(), value);
  }
  return served;
}

describe("the web manifest", () => {
  // Next serves the static manifest `max-age=0, must-revalidate`, which put it
  // at the end of the landing page's critical request chain. A day is safe
  // because the icons it names are versioned filenames.
  it("is cacheable for a day and still carries every global security header", async () => {
    const served = await headersServedAt("/manifest.webmanifest");
    expect(served.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");

    const global = (await headersFor("production", "production")).find((r) => r.source === "/:path*");
    expect(global?.headers.map((h) => h.key)).toContain("Content-Security-Policy");
    for (const { key, value } of global?.headers ?? []) {
      expect(served.get(key.toLowerCase()), key).toBe(value);
    }
  });

  it("lends its Cache-Control to no other path", async () => {
    for (const pathname of ["/", "/manifest.json", "/icons/icon-192-v2.png", "/s/abc/manifest.webmanifest"]) {
      expect((await headersServedAt(pathname)).has("cache-control"), pathname).toBe(false);
    }
  });
});

describe("a public notebook's page", () => {
  // M58, ADR-088 §3. The token is the URL, so an outbound link must not carry
  // it in a Referer, and a revoked link must not answer from a cache.
  it("sends no referrer and is never stored, and keeps every other security header", async () => {
    const served = await headersServedAt("/n/abc");
    expect(served.get("referrer-policy")).toBe("no-referrer");
    expect(served.get("cache-control")).toBe("private, no-store");

    const global = (await headersFor("production", "production")).find((r) => r.source === "/:path*");
    for (const { key, value } of global?.headers ?? []) {
      if (key !== "Referrer-Policy") expect(served.get(key.toLowerCase()), key).toBe(value);
    }
  });

  it("lends neither to a path that only starts with the letter", async () => {
    for (const pathname of ["/notes/abc", "/", "/api/og/notebook/abc"]) {
      const served = await headersServedAt(pathname);
      expect(served.get("referrer-policy"), pathname).not.toBe("no-referrer");
      expect(served.has("cache-control"), pathname).toBe(false);
    }
  });
});

describe("the cover image proxy", () => {
  // Next sets these headers before a route handler runs and then drops any the
  // handler sets under the same name (`send-response.js`), so the sandbox the
  // route sets itself never reached a browser: this entry is what serves it.
  // A cover URL's image opened as a document must run, load and submit nothing.
  it("serves a sandboxed policy that loads nothing, and keeps nosniff", async () => {
    const served = await headersServedAt("/api/cover-image");
    expect(served.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(served.get("x-content-type-options")).toBe("nosniff");
  });

  it("lends its policy to no other path", async () => {
    for (const pathname of ["/trips/abc", "/api/cover-images", "/api/trips/abc/cover"]) {
      expect((await headersServedAt(pathname)).get("content-security-policy"), pathname).toMatch(/^default-src 'self'/);
    }
  });
});

/**
 * KI-2026-09-24-v: when the Sentry build plugin's own telemetry is left at its
 * default (on), every `next build`, including the one e2e serves, sends that
 * telemetry to o1.ingest.sentry.io, bypassing the proxy (seen under strace).
 * The real `withSentryConfig` still runs here; the spy only records the options
 * `next.config.ts` passes it.
 */
describe("the Sentry build plugin", () => {
  it("is configured with its own telemetry off", async () => {
    vi.resetModules();
    const seen: Array<Record<string, unknown> | undefined> = [];
    vi.doMock("@sentry/nextjs/config", async (importOriginal) => {
      const real = await importOriginal<typeof import("@sentry/nextjs/config")>();
      return {
        ...real,
        withSentryConfig: ((config, options) => {
          seen.push(options as Record<string, unknown> | undefined);
          return real.withSentryConfig(config, options);
        }) as typeof real.withSentryConfig,
      };
    });
    try {
      await import("./next.config");
    } finally {
      vi.doUnmock("@sentry/nextjs/config");
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.telemetry).toBe(false);
    // Vercel Cron Monitors do not exist on a self-hosted box.
    expect((seen[0]?.webpack as { automaticVercelMonitors?: boolean }).automaticVercelMonitors).toBe(false);
  });
});

/**
 * KI-2026-09-12-d: four CSP surfaces that had only ever been reasoned about.
 * Each was counter-probed in Chromium against a `next start` production build
 * (and the dev branch against `next dev`) on 2026-09-24; the browser's own
 * `Refused to …` lines are quoted in the resolved entry. These cases pin the
 * directive values those probes proved, so an edit that would reopen one of
 * them fails here instead of in a browser nobody is watching.
 */
describe("the four counter-probed CSP surfaces (KI-2026-09-12-d)", () => {
  // The dev branch: React Refresh needs 'unsafe-eval'. A built app does not, and the probe
  // showed a production build refusing both — which stays true only while
  // the relaxations stay behind `isDev`.
  it("a production build's script-src is exactly 'self' 'unsafe-inline'", async () => {
    expect(directive(await cspFor(undefined, "production"), "script-src")).toBe(
      "script-src 'self' 'unsafe-inline'",
    );
  });

  it("a production build's connect-src admits no ws: scheme", async () => {
    expect(directive(await cspFor(undefined, "production"), "connect-src")).toBe(
      "connect-src 'self' https://tiles.openfreemap.org",
    );
  });

  // M37 D3: covers hotlink Unsplash's image CDN, in every environment, and
  // nothing else of Unsplash's — its API is the server's to call.
  it.each(["production", "preview", undefined])("img-src admits Unsplash's image CDN and no other new origin (%o)", async (env) => {
    expect(directive(await cspFor(env, "production"), "img-src")).toBe(
      "img-src 'self' data: blob: https://tiles.openfreemap.org https://images.unsplash.com",
    );
  });

  it("the dev server's policy carries the dev-only relaxations", async () => {
    const dev = await cspFor(undefined, "development");
    expect(directive(dev, "script-src")).toBe(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
    expect(directive(dev, "connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org ws:");
  });

  // The Google hand-off is not a form submission: next-auth/react's
  // `signIn("google")` POSTs by fetch and then assigns `window.location` to
  // the URL Auth.js returns, so form-action never sees it. 'self' — which the
  // probe showed refusing a form POST to another origin — therefore does not
  // have to name accounts.google.com. Pinned so nobody "fixes" a Google
  // sign-in problem by widening this.
  it.each(["production", "preview", undefined])("form-action is exactly 'self' (%o)", async (env) => {
    for (const nodeEnv of ["production", "development"] as const) {
      expect(directive(await cspFor(env, nodeEnv), "form-action")).toBe("form-action 'self'");
    }
  });

  it.each([
    ["frame-ancestors", "frame-ancestors 'none'"],
    ["object-src", "object-src 'none'"],
    ["base-uri", "base-uri 'none'"],
  ])("%s is 'none' in every environment", async (name, expected) => {
    for (const env of ["production", "preview", undefined]) {
      for (const nodeEnv of ["production", "development"] as const) {
        expect(directive(await cspFor(env, nodeEnv), name)).toBe(expected);
      }
    }
  });

  // The share/invite route's header set is built by filtering the global one,
  // so a filter that dropped or rewrote the CSP would leave exactly the pages
  // that carry bearer tokens without it.
  it("share and invite routes serve the same CSP as every other route", async () => {
    const routes = await headersFor("production", "production");
    const cspOf = (source: string) =>
      routes.find((r) => r.source === source)?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(cspOf("/:path*")).toBeDefined();
    expect(cspOf("/:prefix(s|invite|n)/:path*")).toBe(cspOf("/:path*"));
  });
});
