import { resolve } from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

// `next build` sets NODE_ENV=production; `next dev --turbopack` sets
// development. The dev-only relaxations below exist because the dev server's
// own machinery (React Refresh, the HMR socket) is not present in a built app, and a policy that blocks them makes the
// console unreadable without protecting anything that ships.
const isDev = process.env.NODE_ENV !== "production";

// The self-hosted Plausible's origin (M59), for the two directives its script
// needs: loading, and posting events back. `NEXT_PUBLIC_PLAUSIBLE_SRC` is the
// script's URL; only its origin goes in the policy. Anything that does not
// parse as a URL adds nothing, so a typo cannot widen the policy to a path
// or a keyword.
const plausibleOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ? new URL(process.env.NEXT_PUBLIC_PLAUSIBLE_SRC).origin : "";
  } catch {
    return "";
  }
})();
const plausible = plausibleOrigin ? ` ${plausibleOrigin}` : "";

// Project review M2: the app shipped with no security headers at all — no
// CSP, no frame-ancestors, no Referrer-Policy, no nosniff.
//
// Every directive below is either "no such thing exists in this app" (which
// is most of them) or carries the reason it had to be loosened.
//
// Checked against a production build served by `next start`: the headers
// were read off real responses, and every resource the served HTML and the
// built client chunks reference was enumerated and matched to a directive
// (all same-origin under /_next, plus tiles.openfreemap.org). Twenty surfaces
// were then browser-walked in Chromium 141 against that local build on
// 2026-08-28 with zero violations, including the board, map lens and notebook
// editor the first pass could only reason about.
//
// What that walk could not see, and a preview walk now can (KI-66): the
// deployed environment's own additions. The only one left is the Plausible
// origin above; the Vercel Toolbar's origins went with Vercel (M59).
const contentSecurityPolicy = [
  "default-src 'self'",

  // 'unsafe-inline' is a real weakening and is here for one reason: the App
  // Router streams its RSC payload through inline
  // `<script>self.__next_f.push(...)</script>` tags on every page. The
  // supported alternative is a per-request nonce minted in middleware, which
  // opts every page out of static rendering — a whole-app performance trade
  // for a policy whose other directives (object-src, base-uri, form-action,
  // frame-ancestors) already close the classic injection escalations. Worth
  // revisiting, not worth blocking this fix on.
  //
  // No third-party script is loaded: the fonts are committed files served by
  // next/font/local (app/typefaces.ts), and the one analytics script is our own
  // Plausible. React Refresh needs 'unsafe-eval' in dev.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${plausible}`,

  // Tailwind ships a linked stylesheet, but inline styles are unavoidable
  // here: Radix positions popovers and dialogs with style attributes,
  // @tiptap/core's editor injects a <style> element at runtime (its
  // `injectCSS` ships a stylesheet that happens to carry `.tippy-box`
  // rules — which is why this was first misread as the tippy.js package,
  // now removed as a direct dependency with no importers), and the
  // element wall's enumerated exceptions (map container,
  // computed timeline geometry) are style attributes by design. There is no
  // style equivalent of the nonce trade-off worth making for those.
  "style-src 'self' 'unsafe-inline'",

  // data: for inlined SVG/icons; blob: because maplibre decodes sprite
  // images into `URL.createObjectURL(new Blob(...))` before assigning them
  // to an Image. tiles.openfreemap.org is listed here as well as in
  // connect-src because maplibre's image path has historically moved
  // between fetch and <img>, and the origin is the same one either way — it
  // is the only external origin this app talks to from the browser at all.
  // images.unsplash.com is the cover photos' CDN (M37 D3): Unsplash's
  // guidelines require hotlinking it, so a cover is a plain <img> on that
  // origin and is never proxied through ours. Images only — the API host is
  // called by the server, never by the browser.
  "img-src 'self' data: blob: https://tiles.openfreemap.org https://images.unsplash.com",

  // The fonts are committed files (next/font/local, app/typefaces.ts), so
  // no fonts.gstatic.com origin is needed here.
  "font-src 'self' data:",

  // Vector tiles, glyphs and the style JSON, all fetched by maplibre. The
  // geocode and AI calls go through our own /api routes, not the vendor.
  // ws: in dev is the HMR socket.
  // Plausible receives its events by POST from the browser.
  `connect-src 'self' https://tiles.openfreemap.org${isDev ? " ws:" : ""}${plausible}`,

  // maplibre spawns its tile-decoding workers from a blob: URL.
  "worker-src 'self' blob:",

  // Nothing here embeds anything, and nothing here may be embedded — the
  // second half is the UI-redressing defence the review asked for (the
  // trip-delete and demo-reset buttons). X-Frame-Options below says the same
  // thing for anything that predates frame-ancestors.
  "frame-src 'none'",
  "frame-ancestors 'none'",

  // No <base> tag exists, and no form posts anywhere but here: every form in
  // the app submits through an onSubmit handler. Auth.js's Google hand-off is
  // not a form submission at all — next-auth/react's `signIn("google")`
  // fetches the provider URL and then assigns `window.location`, which
  // form-action does not govern (browser-walked 2026-09-24, KI-2026-09-12-d:
  // lands on accounts.google.com with no violation). Note the distinction: a
  // NATIVE form POST that 302s cross-origin IS governed — Chromium 141 refused
  // one to /api/auth/signin/google with "Refused to send form data to …
  // form-action 'self'" — so a future no-JS form that hands off to another
  // origin by redirect would need that origin listed here.
  "base-uri 'none'",
  "form-action 'self'",

  // No <object>, <embed> or <applet> anywhere.
  "object-src 'none'",
].join("; ");

// Strict-Transport-Security is served by the app now that nothing in front of
// it does (M59), in a built app only: set on the local http dev server, a
// browser that honours it would pin localhost to https for a year. No
// `includeSubDomains` and no `preload`: neither can be taken back quickly, and
// nothing here needs them.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Sends the origin, never the path, to any other site. That already keeps
  // URL-borne tokens off cross-origin Referer headers; /s/** below goes
  // further for the ones that are the whole secret.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
];

const nextConfig: NextConfig = {
  // The container runs `.next/standalone/apps/web/server.js` (Dockerfile). The
  // tracing root is the repo root because this is a pnpm workspace: from
  // `apps/web` alone the trace would miss `@tc/*` and the hoisted
  // `node_modules`, and the server would start without them.
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@tc/contracts", "@tc/domain"],
  // Next 16.3 auto-generates `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`
  // when `next dev` detects an AI coding agent in the environment
  // (`CLAUDECODE`, `CURSOR_TRACE_ID`, `AI_AGENT`, … — see
  // `next/dist/compiled/@vercel/detect-agent`), so it can point the agent at
  // the version-matched docs in `node_modules/next/dist/docs/`. Every agent
  // session that started the dev server therefore left two untracked vendor
  // files in the tree (KI-91).
  //
  // Off here, rather than gitignored, because this repo's operating manual IS
  // `AGENTS.md`/`CLAUDE.md` at the root: a vendor file with the same name one
  // directory down is a trap for the next session that opens either, and an
  // ignore rule would still leave the file on disk to be opened. Not writing
  // them at all is the fix; ignoring them only hides them.
  //
  // The bundled docs are unaffected — they stay readable at
  // `node_modules/next/dist/docs/`, which the root `AGENTS.md` can point to
  // if we ever want that. Documented at
  // `next/dist/docs/01-app/02-guides/ai-agents.md` ("Opting out").
  agentRules: false,
  // `@sentry/profiling-node` resolves a prebuilt `.node` binary at require
  // time. Bundling it would either inline a file the loader then cannot find
  // or drop the binary from the deployment entirely, so it is marked external
  // and left as a plain runtime require. `sentry.server.config.ts` still
  // guards the import — this makes it work, that makes a failure survivable.
  serverExternalPackages: ["@sentry/profiling-node"],
  // `/demo` was the Japan board until M42 made it a picker (D1), and a link
  // into one of its views (`/demo?view=Map`, `?lens=`, `?page=`, `?day=`) still
  // means Japan at that view. One rule per key because `has` is an AND; Next
  // carries the query across, so the view survives. A bare `/demo` is the picker.
  //
  // `/welcome` was the landing's own path until ADR-078 made `/` the landing
  // itself; links to it are out in the world, so it answers 308 to `/` here,
  // in config, rather than in the proxy, which `/` no longer passes through.
  redirects: async () => [
    ...["view", "lens", "page", "day"].map((key) => ({
      source: "/demo",
      has: [{ type: "query" as const, key }],
      destination: "/demo/japan",
      permanent: true,
    })),
    { source: "/welcome", destination: "/", permanent: true },
    // The meal tag's display word is "Food" (TAG_LABEL.meal), so the food
    // slug is the one a person guesses — but the tag's URL slug is the enum,
    // `meal`, and `food` fails tag validation and 404s. Redirect it on every
    // tag route shape, in config like /welcome, so the guess lands on the
    // real page. Next carries the query across, so ?page= survives.
    { source: "/playbooks/tag/food", destination: "/playbooks/tag/meal", permanent: true },
    { source: "/playbooks/city/:slug/food", destination: "/playbooks/city/:slug/meal", permanent: true },
    { source: "/playbooks/country/:slug/tag/food", destination: "/playbooks/country/:slug/tag/meal", permanent: true },
    {
      source: "/playbooks/country/:slug/city/:citySlug/tag/food",
      destination: "/playbooks/country/:slug/city/:citySlug/tag/meal",
      permanent: true,
    },
  ],
  headers: async () => [
    { source: "/:path*", headers: securityHeaders },
    {
      // Share and invite links carry their bearer token in the URL path, so
      // the token IS the URL (ADR-026/ADR-027). `/s/**` renders no external
      // resource today, but the first external link ever added to that page
      // would hand the token to whoever it points at via Referer — the
      // global policy above stops the path leaving our origin, and this
      // stops it being sent at all, including to ourselves (PR #71 review
      // §7, "accepted-risk notes"). `/invite/**` is the same shape of secret
      // and gets the same treatment; the review only named `/s/**` because
      // that is the page that renders shared content.
      //
      // One gap this does NOT close, observed in the 2026-08-28 browser
      // walk: a signed-out hit on `/invite/<token>` 307s to
      // `/signin?callbackUrl=%2Finvite%2F<token>`, so the token continues
      // its life in a query string on a page this rule does not match, under
      // the global `strict-origin-when-cross-origin`. No leak follows —
      // that policy never sends the query cross-origin — which is why
      // `/signin` is deliberately not listed here rather than accidentally
      // omitted. It is recorded because the reasoning, not the rule, is what
      // makes it safe.
      //
      // `/n/**` (M58, ADR-088) is the same shape of secret: a public
      // notebook's token IS its URL, and the page carries a publisher's own
      // external links.
      source: "/:prefix(s|invite|n)/:path*",
      headers: [
        ...securityHeaders.filter((h) => h.key !== "Referrer-Policy"),
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
    {
      // Making a notebook private works on the next request (ADR-088 §3), so
      // no browser or CDN keeps a copy of it. Its own entry, because `/s/`
      // and `/invite/` have no such rule.
      source: "/n/:path*",
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    },
    {
      // A URL cover's image, served from our origin (ADR-081 item 3). Next
      // sets these headers before the route runs and keeps them over any the
      // route sets under the same name, so the route's own sandbox is dropped
      // and this entry is what reaches the browser. Opened as a document, the
      // image runs, loads and submits nothing. The global entry still
      // supplies nosniff and the rest; only the policy is replaced.
      source: "/api/cover-image",
      headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox" }],
    },
    {
      // The manifest is static (`src/app/manifest.ts` reads nothing per
      // request), yet Next serves it `max-age=0, must-revalidate`, so every
      // page load revalidated it — and Lighthouse found it at the end of the
      // landing page's critical request chain. A day is safe because nothing
      // it points at can go stale under it: the icons are versioned filenames
      // (`icon-192-v2.png`), so a new icon is a new URL. The global entry above
      // still matches this path, so the security headers are unchanged; this
      // only adds `Cache-Control`, and `next.config.test.ts` checks both.
      source: "/manifest.webmanifest",
      headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "neablis",

  project: "sentry-canary-planet",

  // The build plugin reports its own errors and timings to Sentry's project,
  // not ours, and does so by default. With `SENTRY_AUTH_TOKEN` unset, a
  // `pnpm build` under strace opened two connections straight to
  // o1.ingest.sentry.io:443, going around HTTPS_PROXY. No other Sentry host
  // was contacted, because release creation and source-map upload already
  // skip themselves when there is no token (KI-2026-09-24-v). Off everywhere,
  // deploys included: the data helps Sentry's product and does nothing for us,
  // and it would tag every one of our builds with our org slug.
  // `next.config.test.ts` checks this setting.
  telemetry: false,

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Vercel Cron Monitors do not exist on a self-hosted box (M59).
    automaticVercelMonitors: false,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
