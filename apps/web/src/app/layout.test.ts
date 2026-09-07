import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// `next/font/google` is transformed by Next's SWC plugin at build time; imported
// under vitest it is a plain object and calling it throws
// `TypeError: Bricolage_Grotesque is not a function`. The three fonts are not
// what this file is about — a stub that returns the one field the layout reads
// (`variable`) is enough to get the tree.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var" });
  return { Bricolage_Grotesque: font, IBM_Plex_Mono: font, IBM_Plex_Sans: font };
});

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import RootLayout from "./layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The layout is a server component: a plain function returning an element tree,
 * with no client runtime to render it into. Reading the tree is the whole of
 * what this asserts — did these two components mount at all — so it is called
 * directly rather than rendered, which keeps this file out of jsdom.
 */
function mounts(component: unknown): boolean {
  const seen = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(seen);
    if (node === null || typeof node !== "object") return false;
    const element = node as ReactElement<{ children?: unknown }>;
    if (element.type === component) return true;
    // Recursive rather than a peek at the body's direct children: whether these
    // two sit loose in <body> or inside a fragment or a wrapper is a detail of
    // how the gate is written, and this test is about whether they mount.
    return seen(element.props?.children);
  };
  return seen(RootLayout({ children: null }));
}

// `@vercel/analytics` and `@vercel/speed-insights` gate only on
// `isDevelopment()`, so a production build that is not ON Vercel mounts them
// both and every page requests two scripts (`/_vercel/insights/script.js`,
// `/_vercel/speed-insights/script.js`) that only Vercel's edge ever serves.
// Off Vercel that is two 404s and two strict-MIME console errors per page —
// 34 of the 2026-09-05 review's ~70 browser-walk finding lines, and the reason
// a "no console errors" e2e assertion cannot be written (KI-2026-09-05-y /
// F-G06).
describe("root layout Vercel telemetry", () => {
  it("mounts neither analytics script when the app is not running on Vercel", () => {
    // Stubbed, not asserted. `expect(process.env.VERCEL).toBeUndefined()` made
    // this test's premise depend on the runner's environment: anywhere VERCEL
    // is set the test failed on its own precondition instead of exercising the
    // off-Vercel branch it exists for (CodeRabbit, PR #155). `afterEach`'s
    // `unstubAllEnvs` restores it.
    vi.stubEnv("VERCEL", "");
    expect(mounts(Analytics)).toBe(false);
    expect(mounts(SpeedInsights)).toBe(false);
  });

  it("mounts both on Vercel, where the scripts are served from our own origin", () => {
    vi.stubEnv("VERCEL", "1");
    expect(mounts(Analytics)).toBe(true);
    expect(mounts(SpeedInsights)).toBe(true);
  });
});
