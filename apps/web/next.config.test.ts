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
//
// `undefined` REMOVES the variable rather than setting it to "" — those are
// different states (`process.env.VERCEL_ENV` is `undefined` vs `""`), and the
// first version of this helper conflated them, so the case named "unset" was
// really testing the empty string and nothing tested a genuinely absent
// variable at all (CodeRabbit, PR #80). Both are covered below now. The
// current `=== "preview"` gate treats them alike, which is exactly why the
// gap was invisible: it costs nothing today and would hide the regression the
// day the gate becomes a truthiness or `startsWith` check.
async function cspFor(vercelEnv: string | undefined): Promise<string> {
  vi.resetModules();
  vi.stubEnv("VERCEL_ENV", vercelEnv);
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

/** Directive name → its source expressions, split on whitespace. */
function sourcesByDirective(csp: string): Map<string, string[]> {
  const entries: Array<[string, string[]]> = csp.split("; ").map((d) => {
    const [name = "", ...sources] = d.trim().split(/\s+/);
    return [name, sources];
  });
  return new Map(entries);
}

/**
 * Exactly what the preview policy adds and removes relative to production,
 * compared as whole source expressions. Directives that are identical in both
 * do not appear, so the assertion against this is total: any origin appearing
 * anywhere it should not shows up here, and so does a directive quietly losing
 * a keyword like `'none'`.
 */
async function previewDelta(): Promise<{
  added: Record<string, string[]>;
  removed: Record<string, string[]>;
}> {
  const preview = sourcesByDirective(await cspFor("preview"));
  const production = sourcesByDirective(await cspFor("production"));
  const added: Record<string, string[]> = {};
  const removed: Record<string, string[]> = {};
  for (const name of new Set([...preview.keys(), ...production.keys()])) {
    const before = production.get(name) ?? [];
    const after = preview.get(name) ?? [];
    const gained = after.filter((s) => !before.includes(s));
    const lost = before.filter((s) => !after.includes(s));
    if (gained.length) added[name] = gained;
    if (lost.length) removed[name] = lost;
  }
  return { added, removed };
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
    ["connect-src", "wss://*.pusher.com"],
    ["frame-src", "https://vercel.live"],
  ];

  it.each(required)("preview %s allows %s", async (name, origin) => {
    expect(directive(await cspFor("preview"), name)).toContain(origin);
  });

  it.each(required)("production %s does NOT allow %s", async (name, origin) => {
    expect(directive(await cspFor("production"), name)).not.toContain(origin);
  });

  // The first version of this test picked the added origins out with
  // `token.includes("vercel.com")`, which CodeQL flagged twice as incomplete
  // URL substring sanitization — correctly, and it was wrong for a second
  // reason it did not mention: `https://assets.vercel.com` *contains*
  // `vercel.com`, so the filter's three substrings overlapped and the "closed
  // set" it claimed to pin was not the set it actually computed. Diffing whole
  // source tokens per directive needs no matching at all.
  it("preview adds exactly these origins to exactly these directives, and nothing else", async () => {
    expect(await previewDelta()).toEqual({
      added: {
        "script-src": ["https://vercel.live"],
        "style-src": ["https://vercel.live"],
        "img-src": ["https://vercel.live", "https://vercel.com"],
        "font-src": ["https://vercel.live", "https://assets.vercel.com"],
        "connect-src": ["https://vercel.live", "wss://*.pusher.com"],
        "frame-src": ["https://vercel.live"],
      },
      // The only thing preview takes away: frame-src stops being 'none' so the
      // Toolbar can frame itself. Asserted rather than ignored, because a diff
      // that only reports additions would call a directive silently dropping
      // 'none' — or `object-src` losing it — no change at all.
      removed: { "frame-src": ["'none'"] },
    });
  });

  it("frame-src stays 'none' anywhere but preview", async () => {
    expect(directive(await cspFor("production"), "frame-src")).toBe("frame-src 'none'");
    expect(directive(await cspFor(undefined), "frame-src")).toBe("frame-src 'none'");
  });

  // This asserted only that `vercel.live` and `pusher.com` were absent, which
  // left `https://vercel.com` and `https://assets.vercel.com` free to appear in
  // a local or CI policy with the test still green (CodeRabbit, PR #80).
  // Naming all four would fix that case and keep the shape that caused it —
  // a hand-maintained list of things to check for. Asserting the whole policy
  // is identical to production cannot fall behind: any origin, on any
  // directive, in either direction, fails it.
  it("a VERCEL_ENV that is absent entirely (local, CI) produces exactly the production policy", async () => {
    // Proves the variable really is gone, not set to "" — the distinction this
    // whole case exists for.
    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(process.env.VERCEL_ENV).toBeUndefined();
    expect(await cspFor(undefined)).toBe(await cspFor("production"));
  });

  it.each(["", "preview-", "PREVIEW", "prod", "development", " preview", "Preview"])(
    "%o is not preview — only the exact value is",
    async (value) => {
      expect(await cspFor(value)).toBe(await cspFor("production"));
    },
  );
});
