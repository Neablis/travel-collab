import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/authConfig";
import {
  PENDING_ADMISSION_COOKIE,
  normalizePendingAdmission,
  pendingAdmissionCookieOptions,
} from "@/lib/pendingAdmission";

// This file was `src/middleware.ts` until the Next 16 upgrade, which
// deprecated the `middleware` file convention in favour of `proxy` (the
// build warns and points at `npx @next/codemod middleware-to-proxy`; that
// codemod only rewrites a named `middleware` export, so this rename was done
// by hand). Nothing about the behaviour below changes — same request seam,
// same matcher semantics, same Edge runtime. Only the filename and the words
// for it moved.
//
// M15 (ADR-024, superseding ADR-023): this builds its own lightweight
// Auth.js instance from the shared edge-safe config in `@/lib/authConfig`,
// rather than importing `@/server/auth`'s live singleton. This is Auth.js
// v5's own documented split-config pattern for edge-compatible request
// interception — it depends on configuration (data), not on the server's
// auth instance or any server internal, so it needs no lint-wall exemption.
// `authConfig` has no `@/server/*` imports and nothing Node-only, so this
// instance is safe to construct in the Edge runtime.
const { auth } = NextAuth(authConfig);

// `/` sends a signed-out visitor to the landing page at
// `/welcome`. This used to happen client-side — Home rendered nothing, fetched
// /api/trips, got a 401, and only then called router.replace("/welcome") —
// which cost a round trip and briefly flashed the authenticated app chrome
// (AppHeader, (app)/layout.tsx) above an empty body before bouncing. Doing it
// here means an unauthenticated request to `/` never reaches that page at
// all: this runs before rendering starts and redirects at the HTTP layer.
//
// CodeRabbit (PR #56, finding 1): the matcher used to be scoped to exactly
// `/`, so a signed-out visitor hitting `/playbooks`, `/trips/:tripId`, or the
// notebook routes under `/trips/:tripId/pages/...` still rendered the full
// authenticated shell (AppHeader + (app)/layout.tsx children) before
// anything 401'd — not a data leak (every apps/web/src/app/api/** handler
// checks auth() independently and that is unchanged), but app chrome and
// empty screens shown to strangers. Fixed here, not in the layout: the
// layout is UI and can't call auth() (lint wall forbids importing
// @/server/* outside src/app/api/**), and this file already exists as the
// right seam.
//
// `/` keeps its own distinct behaviour (redirect to `/welcome`, the
// marketing front door — see e2e/m15-front-door.spec.ts). Every other
// matched route sends a signed-out visitor to `/signin?callbackUrl=<path>`
// instead: they asked for a specific thing, so sign-in should return them to
// it. AuthScreen already honours `callbackUrl` via lib/safeCallbackUrl.ts,
// so this composes with that existing path rather than inventing a new one.
//
// Exported directly as Auth.js v5's wrapper (`auth((req) => ...)`) rather
// than composed with other logic — there's nothing else this route needs. `req.auth` is populated by the wrapper from the session JWT; no
// database read happens here (this project uses JWT sessions with no
// adapter — see server/auth.ts), which is the configuration Auth.js v5's
// docs call out as the one that works reliably in the Edge runtime.
export default auth((req) => {
  if (!req.auth) {
    const { pathname } = req.nextUrl;
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/welcome", req.nextUrl));
    }
    // M27 link 6: the invite landing is PUBLIC — it is what an invite link
    // opens for somebody with no account (SPEC §35.6), so it is served, not
    // bounced to /signin. It stays in the matcher for the other half of what
    // this file did for it:
    //
    // M11a link 5. The gate runs *during* a sign-in, and by then the URL the
    // person arrived on is gone — so the token is banked here and read out of
    // the cookie by `recordSignIn`. It used to ride the /signin redirect; now
    // it rides the landing itself (and *Have a look first*, whose Join leaves
    // for sign-in from there). Every visit re-banks it, so the cookie's short
    // life counts from the last page the person saw, not the first.
    const token = tripInviteToken(pathname);
    if (token !== null) {
      const response = NextResponse.next();
      response.cookies.set(
        PENDING_ADMISSION_COOKIE,
        token,
        pendingAdmissionCookieOptions(req.headers.get("host")),
      );
      return response;
    }
    const callbackUrl = encodeURIComponent(pathname + req.nextUrl.search);
    return NextResponse.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, req.nextUrl));
  }
  return NextResponse.next();
});

/**
 * The token in `/invite/<token>` or `/invite/<token>/look`, or null for
 * anything else this file matches.
 *
 * **Stores, never validates** — deliberately (ADR-024, and the milestone's own
 * trap list). This runs in the Edge runtime with no database, so whether the
 * token names a pending invite is not a question that can be asked here;
 * `server/admission.ts` owns that, reached from `recordSignIn`. Importing it
 * from this file would fail lint and would be wrong before it failed.
 *
 * `/invite` on its own and `/invite/<token>/anything-else` are both matched by
 * the `/invite/:path*` matcher below and neither is an invite link.
 * `normalizePendingAdmission` then applies the shared bound, so a hand-crafted
 * megabyte-long path cannot push that much into a `Set-Cookie` header on an
 * unauthenticated request.
 */
function tripInviteToken(pathname: string): string | null {
  const segment = /^\/invite\/([^/]+)(?:\/look)?\/?$/.exec(pathname)?.[1];
  if (segment === undefined) return null;
  // `pathname` keeps its percent-encoding; a real token is base64url
  // (`access/invites.ts` `mintToken`) and never carries any, so this only
  // matters for junk. `decodeURIComponent` throws on a malformed escape, and a
  // throw here would take down the page for a signed-out visitor — the
  // undecoded string is stored instead, which simply fails to validate later.
  try {
    return normalizePendingAdmission(decodeURIComponent(segment));
  } catch {
    return normalizePendingAdmission(segment);
  }
}

// An explicit matcher list, not a catch-all negative-lookahead: a broad
// `"/((?!api|_next).*)"` pattern risks guarding API routes, static assets,
// and the front-door routes (`/welcome`, `/signin`, `/signup`) themselves,
// none of which should ever hit this file. An explicit list matches
// exactly the `(app)` route group instead:
//   - `/`                 — Home (apps/web/src/app/(app)/page.tsx)
//   - `/playbooks/:path*` — matches `/playbooks` itself *and* any nested
//     path (Next.js treats a `:path*` segment as zero-or-more, so the bare
//     prefix matches too, not just children)
//   - `/trips/:path*`     — matches `/trips/:tripId` and the nested notebook
//     routes under `/trips/:tripId/pages/...` for the same zero-or-more reason
//   - `/invite/:path*`   — the invite landing and its look (M27 link 6).
//     NOT to send anyone to /signin — both pages are public — but to bank the
//     token for M11a's gate on the way past (see the handler above).
export const config = {
  matcher: ["/", "/playbooks/:path*", "/trips/:path*", "/invite/:path*"],
};
