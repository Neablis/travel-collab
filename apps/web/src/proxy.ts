import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { NextResponse, type NextRequest } from "next/server";
import NextAuth, { type NextAuthRequest } from "next-auth";
import { authConfig } from "@/lib/authConfig";
import {
  PENDING_ADMISSION_COOKIE,
  normalizePendingAdmission,
  pendingAdmissionCookieOptions,
} from "@/lib/pendingAdmission";
import { playbooksReaderFor, playbooksRoute } from "@/lib/playbooksReader";
import { SIGNED_IN_HINT_COOKIE } from "@/lib/sessionHint";
import { SIGNUP_REF_COOKIE, normalizeSignupRef, signupRefCookieOptions } from "@/lib/signupRef";

// This file was `src/middleware.ts` until the Next 16 upgrade, which
// deprecated the `middleware` file convention in favour of `proxy` (the
// build warns and points at `npx @next/codemod middleware-to-proxy`; that
// codemod only rewrites a named `middleware` export, so this rename was done
// by hand). Nothing about the behaviour below changes — same request seam,
// same matcher semantics. Only the filename and the words for it moved, and
// the runtime: Next 16 builds a `proxy` file for Node only, never Edge.
//
// M15 (ADR-024, superseding ADR-023): this builds its own lightweight
// Auth.js instance from the shared proxy-safe config in `@/lib/authConfig`,
// rather than importing `@/server/auth`'s live singleton. This is Auth.js
// v5's own documented split-config pattern for request interception (written
// for Edge, which no longer applies here) — it depends on configuration
// (data), not on the server's auth instance or any server internal, so it
// needs no lint-wall exemption.
// `authConfig` has no `@/server/*` imports and no database, so this instance
// stays cheap to construct in front of every matched request.
const { auth } = NextAuth(authConfig);

// Every route this file matches by path is one a signed-out visitor should not
// be shown as-is; the one matched by query instead, `?ref=`, only banks a
// cookie (ADR-079, below). History, because the reasons are still the reasons:
//
// CodeRabbit (PR 56, finding 1): the matcher used to be scoped to exactly
// `/`, so a signed-out visitor hitting `/trips/:tripId`, or the notebook
// routes under `/trips/:tripId/pages/...`, still rendered the full
// authenticated shell (AppHeader + (app)/layout.tsx children) before
// anything 401'd — not a data leak (every apps/web/src/app/api/** handler
// checks auth() independently and that is unchanged), but app chrome and
// empty screens shown to strangers. Fixed here, not in the layout: this file
// already exists as the right seam, and it runs before rendering starts.
//
// A signed-out visitor is sent to `/signin?callbackUrl=<path>`: they asked
// for a specific thing, so sign-in should return them to it. AuthScreen
// already honours `callbackUrl` via lib/safeCallbackUrl.ts.
//
// ADR-078: `/` is NOT matched. It was — a signed-out `/` was rewritten to the
// landing and a signed-in one served Home, so `/` was two pages and answered
// `private, no-store`, and every visit to the bare domain paid for a proxy
// `auth()`. Home moved to `/home` (`HOME_PATH`), `/` became a static page, and
// the one thing it still needs to know — "is this browser signed in?" — it
// learns from a hint cookie read by an inline script, because a static page
// cannot read a session. The app shell sets that hint (`SessionUserProvider`);
// this file only takes it away (below).
//
// The path-matched routes run inside Auth.js v5's wrapper (`auth((req) => ...)`);
// a request matched only for its `?ref=` is answered before it (`proxy`).
// `req.auth` is populated by the wrapper from the session JWT; no database
// read happens here (this project uses JWT sessions with no adapter — see
// server/auth.ts), so the check costs no round trip.
const guarded = auth((req) => {
  const response = bankSignupRef(req, route(req));
  // ADR-078: **this file only ever deletes the hint; it never sets it.** The
  // app shell sets it from the browser once it knows a session user
  // (`SessionUserProvider`), and every matched page a signed-in person reads —
  // `/home`, `/trips/*`, the library's live copy — renders that shell. Here a
  // matched request with no session removes it, which is what ends a stale
  // hint's one wasted hop: the landing sends it to `/home`, `/home` is
  // matched, and this answers it signed out.
  //
  // It used to be set here too, on a signed-in page load. That needed telling
  // a page load from the client router's prefetch by `Sec-Fetch-Dest` — a
  // prefetch answered after sign-out's clear put the hint back — and a browser
  // too old to send that header kept the race. With no set here, there is no
  // response that can put the hint back, whatever the request.
  if (!req.auth && req.cookies.has(SIGNED_IN_HINT_COOKIE)) {
    response.cookies.delete(SIGNED_IN_HINT_COOKIE);
  }
  return response;
});

/** The request seam: the library picks its copy, an invite banks its token, anything else matched goes to sign-in, a signed-out request sheds the signed-in hint, and a `?ref=` link banks its channel. */
export default function proxy(...args: Parameters<typeof guarded>) {
  const [req] = args;
  // ADR-079: a path matched only by the `?ref=` entry (the landing, a place
  // page) gets its cookie and nothing else. No `auth()`: the ref is not about
  // a session, and paying for one there would undo what ADR-078 bought.
  if (!isGuardedPath(req.nextUrl.pathname)) return bankSignupRef(req, NextResponse.next());
  return guarded(...args);
}

/**
 * Bank a `?ref=` channel in `caesura_ref` for `recordSignIn` to copy (ADR-079).
 * **First touch**: a cookie already there is kept, so the channel credited is
 * the one that first brought this browser, not the last link it followed. A
 * value that is not a channel label is dropped.
 *
 * A response that sets it is `private, no-store`: a CDN keeping it would hand
 * this visitor's `Set-Cookie` to the next one.
 */
function bankSignupRef(req: NextRequest, response: NextResponse): NextResponse {
  if (req.cookies.has(SIGNUP_REF_COOKIE)) return response;
  const ref = normalizeSignupRef(req.nextUrl.searchParams.get("ref"));
  if (ref === null) return response;
  response.cookies.set(SIGNUP_REF_COOKIE, ref, signupRefCookieOptions(req.headers.get("host")));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Could one of the matcher's string entries, which need `auth()`, have let
 * this path in? Read from `config.matcher` rather than listed again, so a
 * route added there cannot be skipped past `auth()` by a second list that was
 * not updated.
 *
 * It fails closed: the ref branch skips `auth()`, so only a path proven to be
 * matched by none of them may take it. Each entry is compiled by Next's own
 * path-to-regexp wrapper, case-insensitive as Vercel matches it, and loosened
 * to any `.` suffix, which covers the `.rsc` and `.segments/…` transport forms
 * Next adds to every entry (`getMiddlewareMatchers`). Matching more than Next
 * only costs an `auth()` the request did not need.
 */
function isGuardedPath(pathname: string): boolean {
  guardedEntries ??= config.matcher.flatMap((entry) =>
    typeof entry === "string" ? [getPathMatch(entry, { regexModifier: (source) => source.replace(/\$$/, "(?:\\..*)?$") })] : [],
  );
  return guardedEntries.some((matches) => matches(pathname) !== false);
}
// Compiled on first use: `config` is declared below, so it is not there yet
// while this module's top level runs.
let guardedEntries: ReturnType<typeof getPathMatch>[] | undefined;

// What the request gets before a stale hint is taken off it.
function route(req: NextAuthRequest): NextResponse {
  // The public library, for everyone: a reader with no session and no query
  // gets the cached copy, anyone else the per-request one (`playbooksReader.ts`).
  // `req.auth` rather than the cookie's presence: a cookie whose session has
  // expired would be answered signed-out by the live page too.
  const library = playbooksRoute(
    req.nextUrl.pathname,
    playbooksReaderFor(Boolean(req.auth), req.nextUrl.pathname, req.nextUrl.searchParams),
  );
  if (library !== null) {
    const target = new URL(req.nextUrl);
    target.pathname = library;
    return NextResponse.rewrite(target);
  }
  if (req.auth) return NextResponse.next();
  const { pathname } = req.nextUrl;
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

/**
 * The token in `/invite/<token>` or `/invite/<token>/look`, or null for
 * anything else this file matches.
 *
 * **Stores, never validates** — deliberately (ADR-024, and the milestone's own
 * trap list). This runs before every matched request with no database, so
 * whether the token names a pending invite is not a question asked here;
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
// and the front-door routes (`/`, `/signin`, `/signup`) themselves,
// none of which should ever hit this file. An explicit list matches
// exactly the `(app)` routes that need a session, plus the invite links:
//   - `/home`             — Home (apps/web/src/app/(app)/home/page.tsx). Not
//     `/home/:path*`: nothing lives under it.
//   - `/trips/:path*`     — matches `/trips/:tripId` and the nested notebook
//     routes under `/trips/:tripId/pages/...` (Next.js treats a `:path*`
//     segment as zero-or-more, so the bare prefix matches too, not just
//     children)
//   - `/invite/:path*`   — the invite landing and its look (M27 link 6).
//     NOT to send anyone to /signin — both pages are public — but to bank the
//     token for M11a's gate on the way past (see the handler above).
//   - `/playbooks/:path*` — the public library, bare prefix included. NOT to
//     send anyone to /signin (ADR-061: a shared playbook link opens for
//     somebody with no account; what they may DO there is decided by the API
//     routes, which answer every write 401), but to pick which copy of the
//     page they get. Every request is rewritten: the routes live under
//     `app/playbooks/live` and `app/playbooks/[copy]`, so nothing at
//     `/playbooks` renders without this file. As on every other matched
//     route, a signed-out request sheds a stale signed-in hint (ADR-078), the
//     cached copy included; the live copy's shell is what sets it.
//   - any page with a `ref` query parameter (ADR-079), `/` included, to bank
//     the channel a launch link names. A `has` condition rather than a path,
//     so a request for `/` without one still never enters this file and the
//     landing stays static (ADR-078). Not `/api` or `/_next`: no launch link
//     points there.
export const config = {
  matcher: [
    "/home",
    "/trips/:path*",
    "/invite/:path*",
    "/playbooks/:path*",
    { source: "/((?!api/|_next/).*)", has: [{ type: "query", key: "ref" }] },
  ],
};
