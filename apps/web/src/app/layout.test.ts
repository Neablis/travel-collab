import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import { RouteViewTransition } from "@/components/RouteViewTransition";
import { LaunchOverlay } from "@/components/welcome/WelcomeMoment";
import { LAUNCH_SCRIPT } from "@/lib/welcomeCue";
import RootLayout, { metadata, viewport } from "./layout";

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

// Decision 18 (ADR-082 §3): the front door has no `AppShell`, so the root
// layout's slot is where its pages get the route cross-fade.
describe("root layout route cross-fade", () => {
  it("puts the page inside a view transition", () => {
    const page = { type: "p", props: {}, key: null } as ReactElement;
    const inside = (node: unknown, within: boolean): boolean => {
      if (node === page) return within;
      if (Array.isArray(node)) return node.some((n) => inside(n, within));
      if (node === null || typeof node !== "object") return false;
      const element = node as ReactElement<{ children?: unknown }>;
      return inside(element.props?.children, within || element.type === RouteViewTransition);
    };
    expect(inside(RootLayout({ children: page }), false)).toBe(true);
  });
});

// Mitchell, on Android Chrome (PR 436's preview): the keyboard covered the
// Chat and Ask composers. Since Chrome 108 the keyboard resizes only the
// visual viewport, so the sheet's `bottom: 0` and `80dvh` stayed behind it.
describe("root layout viewport", () => {
  it("lets the on-screen keyboard resize the layout, so a bottom-anchored composer rides above it", () => {
    expect(viewport.interactiveWidget).toBe("resizes-content");
  });
});

// M54 decision 6: on a home-screen launch the overlay covers the first frame,
// which needs both halves in the server HTML — the head script that marks the
// launch before the body paints, and the overlay it reveals.
describe("root layout launch overlay", () => {
  it("marks a home-screen launch from the head and carries the overlay in the body", () => {
    const tree = RootLayout({ children: null }) as ReactElement<{ children: ReactElement[] }>;
    const [head, body] = tree.props.children as ReactElement<{ children: unknown }>[];
    const scripts = [head!.props.children]
      .flat(2)
      .map((node) => (node as ReactElement<{ dangerouslySetInnerHTML?: { __html: string } }>)?.props?.dangerouslySetInnerHTML?.__html);
    expect(scripts).toContain(LAUNCH_SCRIPT);
    expect(mounts(LaunchOverlay)).toBe(true);
    expect(body!.type).toBe("body");
  });
});

// M54 decision 7. iOS picks a launch screen by an exact device-size media query
// and shows a blank one when the file it names is missing or the wrong size,
// so every link must name a committed file whose pixels are the query's, and
// every file the generator draws must be linked.
describe("root layout iOS startup images", () => {
  const icons = join(process.cwd(), "public/icons");
  const startup = metadata.appleWebApp as { startupImage: { url: string; media: string }[] };
  // A PNG's width and height are the IHDR chunk's first two words.
  const pixels = (file: string) => {
    const png = readFileSync(join(icons, file));
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };

  it("links a file of the right pixel size for each screen", () => {
    expect(startup.startupImage.length).toBeGreaterThan(0);
    for (const { url, media } of startup.startupImage) {
      const [, width, height, ratio] = media.match(/device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)\)/)!.map(Number);
      expect(pixels(url.replace("/icons/", ""))).toEqual([width! * ratio!, height! * ratio!]);
    }
  });

  it("links every startup image the generator draws", () => {
    const drawn = readdirSync(icons).filter((file) => file.startsWith("startup-")).map((file) => `/icons/${file}`);
    expect(startup.startupImage.map(({ url }) => url).sort()).toEqual(drawn.sort());
  });
});
