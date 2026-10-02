"use client";

import dynamic from "next/dynamic";
import "@scalar/api-reference-react/style.css";

// **Scalar, bundled, configured for this CSP and nothing looser.**
// `next.config.ts` allows scripts, styles and fetches from `'self'` only (plus
// map tiles), so every option below that defaults to reaching another origin
// is turned off rather than allowed:
// - `url` is the served `/api/v1/openapi`, fetched same-origin at runtime. The
//   UI may not import the JSON out of `src/app/api` (the lint wall), and a
//   fetched document is the one a caller actually gets.
// - `withDefaultFonts: false` — the default pulls fonts from fonts.scalar.com,
//   which `font-src 'self' data:` blocks. Our own next/font faces are passed
//   in through `customCss` instead.
// - `telemetry: false`, `agent.disabled` (Scalar's hosted "ask AI" chat),
//   `mcp.disabled` ("Generate MCP", a link into Scalar's dashboard — drawn on
//   localhost by default), `hideClientButton` (the upsell into Scalar's hosted
//   API client) and `showDeveloperTools: "never"` — each one is a call out to
//   scalar.com or a button that leads there.
// - No `proxyUrl`. The request runner calls this origin, which needs no proxy;
//   a proxy would route a caller's bearer token through Scalar's servers.
//
// `servers` exists because the document has none and its paths are `/v1/...`:
// without it the runner and every generated snippet would send
// `<origin>/v1/account`, a 404. The document itself stays as it is — adding a
// `servers` entry there moves `API_FINGERPRINT` and is a contract change of
// its own.
//
// **Zod 4 inside Scalar probes for `eval`, and the probe is a CSP violation.**
// Its first parse runs `Function("")` in a try/catch to decide whether it may
// compile validators. Under `script-src` without `'unsafe-eval'` the catch
// works and validation falls back — but the browser has already raised a
// `securitypolicyviolation` for it, on every visit. Zod 4 reads its global
// config from `globalThis.__zod_globalConfig` (so separate copies share one),
// and `jitless` skips the probe. Set here, before the dynamic import below
// loads Scalar's chunk; browser only, so no server-side zod is touched.
if (typeof window !== "undefined") {
  const zodHost = globalThis as { __zod_globalConfig?: Record<string, unknown> };
  (zodHost.__zod_globalConfig ??= {}).jitless = true;
}

// `ssr: false` because Scalar is a Vue app that mounts into a `div` from an
// effect; there is nothing to render on the server, and its module touches
// browser globals on import.
const ApiReferenceReact = dynamic(
  () => import("@scalar/api-reference-react").then((m) => m.ApiReferenceReact),
  // Nothing while it loads, per the loading wall (KI-2026-09-20-e): the
  // header above is the page's real chrome, and it is already drawn.
  { ssr: false, loading: () => null },
);

// The palette is ours, through the tokens `globals.css` already emits — no
// colour literal here, so the colour wall has nothing to say and a retuned
// look reaches the reference too. Light only: the app has no dark mode.
const CUSTOM_CSS = `
.light-mode {
  --scalar-background-1: var(--color-paper);
  --scalar-background-2: var(--color-surface);
  --scalar-background-3: var(--color-moss);
  --scalar-background-accent: var(--color-brand-tint);
  --scalar-color-1: var(--color-ink);
  --scalar-color-2: var(--color-slate);
  --scalar-color-3: var(--color-slate);
  --scalar-color-accent: var(--color-brand);
  --scalar-border-color: var(--color-hairline);
}
:root {
  --scalar-font: var(--font-next-sans), ui-sans-serif, system-ui, sans-serif;
  --scalar-font-code: var(--font-next-mono), ui-monospace, monospace;
}
`;

/** The Scalar reference for the served OpenAPI document, mounted client-side. */
export function ApiReferenceClient() {
  return (
    <ApiReferenceReact
      configuration={{
        url: "/api/v1/openapi",
        servers: [{ url: "/api", description: "This deployment" }],
        withDefaultFonts: false,
        telemetry: false,
        agent: { disabled: true },
        mcp: { disabled: true },
        hideClientButton: true,
        showDeveloperTools: "never",
        theme: "default",
        forceDarkModeState: "light",
        hideDarkModeToggle: true,
        customCss: CUSTOM_CSS,
        documentDownloadType: "json",
      }}
    />
  );
}
