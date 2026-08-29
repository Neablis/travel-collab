import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * The CSP is a build-time string keyed off VERCEL_ENV, so nothing that runs in
 * this repo's normal lanes ever observes the preview variant — a preview-only
 * directive is invisible until it is deployed and a browser refuses something.
 * That is exactly how the Vercel Toolbar came to be blocked for as long as it
 * was. These tests read the header out of `headers()` for both environments.
 *
 * The pairing matters more than either half: the point of gating the Toolbar
 * origins on `isPreview` is that production's policy does NOT gain them, so
 * every "preview allows X" assertion has a "production still refuses X" twin.
 */

// next.config.ts reads process.env at module scope, so each case needs a fresh
// module registry rather than a shared import.
async function cspFor(vercelEnv: string | undefined): Promise<string> {
  vi.resetModules();
  if (vercelEnv === undefined) vi.stubEnv("VERCEL_ENV", "");
  else vi.stubEnv("VERCEL_ENV", vercelEnv);
  const { default: config } = await import("./next.config");
  const routes = await config.headers!();
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

describe("the preview CSP admits the Vercel Toolbar", () => {
  // Each entry is the directive the Toolbar's own documented policy needs
  // (https://vercel.com/docs/vercel-toolbar/managing-toolbar) and the origin
  // it needs there.
  const required: ReadonlyArray<readonly [string, string]> = [
    ["script-src", "https://vercel.live"],
    ["style-src", "https://vercel.live"],
    ["img-src", "https://vercel.live"],
    ["img-src", "https://vercel.com"],
    ["font-src", "https://vercel.live"],
    ["font-src", "https://assets.vercel.com"],
    ["connect-src", "https://vercel.live"],
    ["connect-src", "wss://ws-us3.pusher.com"],
    ["frame-src", "https://vercel.live"],
  ];

  it.each(required)("preview %s allows %s", async (name, origin) => {
    expect(directive(await cspFor("preview"), name)).toContain(origin);
  });

  it.each(required)("production %s does NOT allow %s", async (name, origin) => {
    expect(directive(await cspFor("production"), name)).not.toContain(origin);
  });

  it("only the toolbar's own origins are added, and only on preview", async () => {
    const added = (await cspFor("preview"))
      .split(/[;\s]+/)
      .filter((t) => t.includes("vercel.live") || t.includes("pusher.com") || t.includes("vercel.com"));
    // va.vercel-scripts.com is the dev-only analytics debug script and must not
    // appear here; NODE_ENV is "test" under vitest, which is not "production",
    // so the isDev branch is live and this assertion is the one that would
    // catch a preview/dev mix-up.
    expect(new Set(added)).toEqual(
      new Set([
        "https://vercel.live",
        "https://vercel.com",
        "https://assets.vercel.com",
        "wss://ws-us3.pusher.com",
      ]),
    );
  });

  it("frame-src stays 'none' anywhere but preview", async () => {
    expect(directive(await cspFor("production"), "frame-src")).toBe("frame-src 'none'");
    expect(directive(await cspFor(undefined), "frame-src")).toBe("frame-src 'none'");
  });

  it("an unset VERCEL_ENV (local, CI) is treated as not-preview", async () => {
    const csp = await cspFor(undefined);
    expect(csp).not.toContain("vercel.live");
    expect(csp).not.toContain("pusher.com");
  });
});
