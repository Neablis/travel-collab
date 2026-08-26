import { NextResponse } from "next/server";
import { auth } from "@/server/auth";

// M15 (ADR-023): `/` sends a signed-out visitor to the landing page at
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
// @/server/* outside src/app/api/**), and middleware already exists as the
// right seam.
//
// `/` keeps its own distinct behaviour (redirect to `/welcome`, the
// marketing front door — see e2e/m15-front-door.spec.ts). Every other
// matched route sends a signed-out visitor to `/signin?callbackUrl=<path>`
// instead: they asked for a specific thing, so sign-in should return them to
// it. AuthScreen already honours `callbackUrl` via lib/safeCallbackUrl.ts,
// so this composes with that existing path rather than inventing a new one.
//
// Exported directly as Auth.js v5's middleware wrapper (`auth((req) => ...)`)
// rather than composed with other logic — there's nothing else this route
// needs. `req.auth` is populated by the wrapper from the session JWT; no
// database read happens here (this project uses JWT sessions with no
// adapter — see server/auth.ts), which is the configuration Auth.js v5's
// docs call out as the one that works reliably in the Edge runtime.
export default auth((req) => {
  if (!req.auth) {
    const { pathname } = req.nextUrl;
    if (pathname === "/") {
      return NextResponse.redirect(new URL("/welcome", req.nextUrl));
    }
    const callbackUrl = encodeURIComponent(pathname + req.nextUrl.search);
    return NextResponse.redirect(new URL(`/signin?callbackUrl=${callbackUrl}`, req.nextUrl));
  }
  return NextResponse.next();
});

// An explicit matcher list, not a catch-all negative-lookahead: a broad
// `"/((?!api|_next).*)"` pattern risks guarding API routes, static assets,
// and the front-door routes (`/welcome`, `/signin`, `/signup`) themselves,
// none of which should ever hit this middleware. An explicit list matches
// exactly the `(app)` route group instead:
//   - `/`                 — Home (apps/web/src/app/(app)/page.tsx)
//   - `/playbooks/:path*` — matches `/playbooks` itself *and* any nested
//     path (Next.js treats a `:path*` segment as zero-or-more, so the bare
//     prefix matches too, not just children)
//   - `/trips/:path*`     — matches `/trips/:tripId` and the nested notebook
//     routes under `/trips/:tripId/pages/...` for the same zero-or-more reason
export const config = { matcher: ["/", "/playbooks/:path*", "/trips/:path*"] };
