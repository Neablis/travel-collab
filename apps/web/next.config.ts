import type { NextConfig } from "next";

// `next build` sets NODE_ENV=production; `next dev --turbopack` sets
// development. The dev-only relaxations below exist because the dev server's
// own machinery (React Refresh, the HMR socket, the analytics debug script)
// is not present in a built app, and a policy that blocks them makes the
// console unreadable without protecting anything that ships.
const isDev = process.env.NODE_ENV !== "production";

// Project review M2: the app shipped with no security headers at all — no
// CSP, no frame-ancestors, no Referrer-Policy, no nosniff.
//
// Every directive below is either "no such thing exists in this app" (which
// is most of them) or carries the reason it had to be loosened.
//
// Checked against a production build served by `next start`: the headers
// were read off real responses, and every resource the served HTML and the
// built client chunks reference was enumerated and matched to a directive
// (all same-origin under /_next, plus tiles.openfreemap.org). It has NOT
// been exercised by a real rendering engine — this container has no browser
// and cdn.playwright.dev is blocked by the proxy — so the authenticated
// surfaces (board, map lens, notebook editor) are reasoned about, not
// observed. If a violation shows up, it will be in one of those three.
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
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}`,

  // Tailwind ships a linked stylesheet, but inline styles are unavoidable
  // here: Radix positions popovers and dialogs with style attributes,
  // tippy.js (the notebook's slash-command popup) injects a <style> element
  // at runtime, and the element wall's enumerated exceptions (map container,
  // computed timeline geometry) are style attributes by design. There is no
  // style equivalent of the nonce trade-off worth making for those.
  "style-src 'self' 'unsafe-inline'",

  // data: for inlined SVG/icons; blob: because maplibre decodes sprite
  // images into `URL.createObjectURL(new Blob(...))` before assigning them
  // to an Image. tiles.openfreemap.org is listed here as well as in
  // connect-src because maplibre's image path has historically moved
  // between fetch and <img>, and the origin is the same one either way — it
  // is the only external origin this app talks to from the browser at all.
  "img-src 'self' data: blob: https://tiles.openfreemap.org",

  // next/font/google downloads and self-hosts at build time, so no
  // fonts.gstatic.com origin is needed here.
  "font-src 'self' data:",

  // Vector tiles, glyphs and the style JSON, all fetched by maplibre. The
  // geocode and AI calls go through our own /api routes, not the vendor.
  // ws: in dev is the HMR socket.
  `connect-src 'self' https://tiles.openfreemap.org${isDev ? " ws:" : ""}`,

  // maplibre spawns its tile-decoding workers from a blob: URL.
  "worker-src 'self' blob:",

  // Nothing here embeds anything, and nothing here may be embedded — the
  // second half is the UI-redressing defence the review asked for (the
  // trip-delete and demo-reset buttons). X-Frame-Options below says the same
  // thing for anything that predates frame-ancestors.
  "frame-src 'none'",
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
  // Sends the origin, never the path, to any other site. That already keeps
  // URL-borne tokens off cross-origin Referer headers; /s/** below goes
  // further for the ones that are the whole secret.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@tc/contracts", "@tc/domain"],
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
      source: "/:prefix(s|invite)/:path*",
      headers: [
        ...securityHeaders.filter((h) => h.key !== "Referrer-Policy"),
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
  ],
};

export default nextConfig;
