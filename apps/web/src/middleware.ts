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
// Exported directly as Auth.js v5's middleware wrapper (`auth((req) => ...)`)
// rather than composed with other logic — there's nothing else this route
// needs. `req.auth` is populated by the wrapper from the session JWT; no
// database read happens here (this project uses JWT sessions with no
// adapter — see server/auth.ts), which is the configuration Auth.js v5's
// docs call out as the one that works reliably in the Edge runtime.
export default auth((req) => {
  if (!req.auth) {
    return NextResponse.redirect(new URL("/welcome", req.nextUrl));
  }
  return NextResponse.next();
});

// Scoped to exactly `/`. Do not broaden this matcher: signed-out access to
// `/trips/:id` and `/playbooks` is deliberately out of scope for M15 (those
// routes still rely on their own server-side/API auth checks), and running
// middleware on every request would cost latency this milestone doesn't need.
export const config = { matcher: ["/"] };
