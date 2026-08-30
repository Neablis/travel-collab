import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// `next build` sets NODE_ENV=production; `next dev --turbopack` sets
// development. The dev-only relaxations below exist because the dev server's
// own machinery (React Refresh, the HMR socket, the analytics debug script)
// is not present in a built app, and a policy that blocks them makes the
// console unreadable without protecting anything that ships.
const isDev = process.env.NODE_ENV !== "production";

// Vercel sets VERCEL_ENV at build time, and a preview build is the only place
// the Vercel Toolbar is ever injected. It is not cosmetic here: the Toolbar is
// how the Flags Explorer flips `ai-live` for one reviewer's session, which
// `docs/guidelines/environments-and-deploys.md` documents as the way to try
// live AI on a preview without changing the stored value for everyone. The
// policy below blocked its loader outright, so that workflow had been broken
// since the CSP landed — found by browser-walking a preview (see
// `pnpm --filter web walk:preview`), which is exactly the surface the CSP's
// own comment records as unobserved. Preview only: production never loads
// vercel.live, and widening its policy for a tool it does not serve would be
// paying for nothing.
const isPreview = process.env.VERCEL_ENV === "preview";
const toolbar = (...origins: string[]) => (isPreview ? ` ${origins.join(" ")}` : "");

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
// deployed environment's own additions. The first walk of a real preview,
// 2026-08-29, found exactly one — the Vercel Toolbar's loader, blocked. See
// the isPreview note above.
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
  // No third-party script is loaded in production: next/font/google
  // self-hosts at build time, and @vercel/analytics serves from
  // /_vercel/insights on our own origin. In dev it fetches a debug script
  // from va.vercel-scripts.com instead, and React Refresh needs 'unsafe-eval'.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}${toolbar("https://vercel.live")}`,

  // Tailwind ships a linked stylesheet, but inline styles are unavoidable
  // here: Radix positions popovers and dialogs with style attributes,
  // @tiptap/core's editor injects a <style> element at runtime (its
  // `injectCSS` ships a stylesheet that happens to carry `.tippy-box`
  // rules — which is why this was first misread as the tippy.js package,
  // now removed as a direct dependency with no importers), and the
  // element wall's enumerated exceptions (map container,
  // computed timeline geometry) are style attributes by design. There is no
  // style equivalent of the nonce trade-off worth making for those.
  `style-src 'self' 'unsafe-inline'${toolbar("https://vercel.live")}`,

  // data: for inlined SVG/icons; blob: because maplibre decodes sprite
  // images into `URL.createObjectURL(new Blob(...))` before assigning them
  // to an Image. tiles.openfreemap.org is listed here as well as in
  // connect-src because maplibre's image path has historically moved
  // between fetch and <img>, and the origin is the same one either way — it
  // is the only external origin this app talks to from the browser at all.
  `img-src 'self' data: blob: https://tiles.openfreemap.org${toolbar("https://vercel.live", "https://vercel.com")}`,

  // next/font/google downloads and self-hosts at build time, so no
  // fonts.gstatic.com origin is needed here.
  `font-src 'self' data:${toolbar("https://vercel.live", "https://assets.vercel.com")}`,

  // Vector tiles, glyphs and the style JSON, all fetched by maplibre. The
  // geocode and AI calls go through our own /api routes, not the vendor.
  // ws: in dev is the HMR socket.
  // `wss://*.pusher.com` rather than the `wss://ws-us3.pusher.com` Vercel's
  // Toolbar CSP documentation names. The `ws-us3` segment is a Pusher cluster
  // Vercel picked and can move without telling us, and the failure mode if it
  // does is precisely the one this whole change exists to fix: a CSP silently
  // refusing a Vercel-side URL, client-side, on a surface no lane loads. We
  // are not going to notice that twice. The widening buys nothing an attacker
  // wants — it is preview-only, `connect-src` only, and confined to hosts
  // under a domain we already have to trust for the Toolbar to work at all.
  `connect-src 'self' https://tiles.openfreemap.org${isDev ? " ws:" : ""}${toolbar("https://vercel.live", "wss://*.pusher.com")}`,

  // maplibre spawns its tile-decoding workers from a blob: URL.
  "worker-src 'self' blob:",

  // Nothing here embeds anything, and nothing here may be embedded — the
  // second half is the UI-redressing defence the review asked for (the
  // trip-delete and demo-reset buttons). X-Frame-Options below says the same
  // thing for anything that predates frame-ancestors.
  isPreview ? "frame-src https://vercel.live" : "frame-src 'none'",
  "frame-ancestors 'none'",

  // No <base> tag exists, and no form posts anywhere but here: every form in
  // the app submits through an onSubmit handler, and Auth.js's Google
  // hand-off is a 302 redirect, which form-action does not govern.
  "base-uri 'none'",
  "form-action 'self'",

  // No <object>, <embed> or <applet> anywhere.
  "object-src 'none'",
].join("; ");

// Strict-Transport-Security is deliberately absent: Vercel serves it on our
// deployments already, and setting it here would also emit it from the local
// http dev server, where a browser that honours it pins localhost to https
// for months.
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Not a security header — it is the one thing that makes Sentry's browser
  // profiling work, and it lives in this list because this list is what is
  // already attached to every route.
  //
  // The JS Self-Profiling API (`new Profiler(...)`) is gated on the document
  // having been served with this policy. Without it
  // `Sentry.browserProfilingIntegration()` initialises, fails to construct a
  // profiler, and turns itself off for the rest of the session — silently
  // outside a debug build. So "we enabled browser profiling" is a claim about
  // THIS header as much as about that integration, and `next.config.test.ts`
  // asserts it for exactly that reason.
  //
  // It grants a capability to our own document only; it is not a `*` or a
  // cross-origin grant, and it cannot be used to profile anyone else's page.
  { key: "Document-Policy", value: "js-profiling" },
  // Sends the origin, never the path, to any other site. That already keeps
  // URL-borne tokens off cross-origin Referer headers; /s/** below goes
  // further for the ones that are the whole secret.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@tc/contracts", "@tc/domain"],
  // `@sentry/profiling-node` resolves a prebuilt `.node` binary at require
  // time. Bundling it would either inline a file the loader then cannot find
  // or drop the binary from the deployment entirely, so it is marked external
  // and left as a plain runtime require. `sentry.server.config.ts` still
  // guards the import — this makes it work, that makes a failure survivable.
  serverExternalPackages: ["@sentry/profiling-node"],
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
      source: "/:prefix(s|invite)/:path*",
      headers: [
        ...securityHeaders.filter((h) => h.key !== "Referrer-Policy"),
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
  ],
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "neablis",

  project: "sentry-canary-planet",

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
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
