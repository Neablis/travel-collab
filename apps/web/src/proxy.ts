import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { NextResponse, type NextRequest } from "next/server";
import NextAuth, { type NextAuthRequest } from "next-auth";
import { authConfig, type SessionWithMfa } from "@/lib/authConfig";
import {
  PENDING_ADMISSION_COOKIE,
  normalizePendingAdmission,
  pendingAdmissionCookieOptions,
} from "@/lib/pendingAdmission";
import { isMaintenance, maintenanceResponse } from "@/lib/maintenance";
import { isInternalPlaybooksPath, playbooksReaderFor, playbooksRoute } from "@/lib/playbooksReader";
import { REQUEST_PATH_HEADER, SIGNED_IN_HINT_COOKIE } from "@/lib/sessionHint";
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

// Every route this file matches by a path of its own is one a signed-out
// visitor should not be shown as-is; the one matched by query instead,
// `?ref=`, only banks a cookie (ADR-079, below), and the catch-all entry at
// the end of the matcher only answers maintenance mode (PR 794). History, because the reasons are still the reasons:
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
// ADR-078: `/` is NOT matched for a session. It was — a signed-out `/` was rewritten to the
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
//
// It is built per request around the URL the server was asked for (`own`),
// because the `req` Auth.js hands in may not carry it: with `AUTH_URL` set,
// Auth.js rebuilds the request on that origin (`reqWithEnvURL`). A redirect
// can go there, but a rewrite cannot: Next serves a rewrite itself only when
// its origin is the server's own, and proxies anything else out over the
// network. On the Coolify box that sent every library page to
// `https://caesura.today/playbooks/cached/…` and answered "Internal Server
// Error" (`Failed to proxy`), 2026-11-09. Building the wrapper costs a closure.
const guard = (own: URL) => auth((req) => {
  const response = bankSignupRef(req, route(req, own));
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
export default function proxy(...args: Parameters<ReturnType<typeof guard>>) {
  const [req] = args;
  // PR 794: the cutover's maintenance mode answers first, for every page and
  // discovery path the matcher's catch-all brings in. `/api` is not among them.
  if (isMaintenance()) return maintenanceResponse(req.nextUrl.pathname);
  // The catch-all entry exists for maintenance mode alone. A page the matcher
  // did not reach before it gets the answer it got then: no cookie banked and
  // no `auth()`.
  if (!isGuardedPath(req.nextUrl.pathname) && !isRefLanding(req)) return NextResponse.next();
  // ADR-079: a path matched only by the `?ref=` entry (the landing, a place
  // page) gets its cookie and nothing else. No `auth()`: the ref is not about
  // a session, and paying for one there would undo what ADR-078 bought.
  if (!isGuardedPath(req.nextUrl.pathname)) return bankSignupRef(req, NextResponse.next());
  const answer = guard(req.nextUrl)(...args);
  // Auth.js returns a promise; the unit tests' stand-in answers at once.
  return answer instanceof Promise ? answer.then(shedCachedCopyAuthCookies) : shedCachedCopyAuthCookies(answer);
}

// Auth.js's wrapper appends the cookies its session lookup minted, a CSRF
// token and a callback URL, to every response it wraps, after the handler has
// run (`handleAuth`), so only a wrapper outside it can take them off.
const AUTH_FLOW_COOKIE = /^(?:__Host-|__Secure-)?authjs\.(?:csrf-token|callback-url)=/;

/**
 * The library's cached copy without Auth.js's CSRF and callback-URL cookies
 * (2026-11-17). The page is the same for every signed-out reader and says
 * `s-maxage` (`app/playbooks/[copy]/layout.tsx`), but a response that sets a
 * cookie is one no CDN will keep, Cloudflare by default included, so every
 * crawler's fetch reached the server and, past a deploy or a day, the
 * database. Neither cookie is needed to read: Auth.js sets both again from
 * `/api/auth/csrf` and `/signin` when a sign-in starts. Every other response
 * keeps them, and so does any other cookie on this one (a shed hint, a banked
 * `?ref=`, a cleared expired session), which is a response no CDN keeps anyway.
 */
function shedCachedCopyAuthCookies(response: Response | void): Response | void {
  if (!(response instanceof Response)) return response;
  const rewrite = response.headers.get("x-middleware-rewrite");
  if (rewrite === null || !/^\/playbooks\/cached(?:\/|$)/.test(new URL(rewrite, "http://x").pathname)) return response;
  const cookies = response.headers.getSetCookie();
  const kept = cookies.filter((line) => !AUTH_FLOW_COOKIE.test(line));
  if (kept.length === cookies.length) return response;
  response.headers.delete("set-cookie");
  for (const line of kept) response.headers.append("set-cookie", line);
  return response;
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

// The `?ref=` matcher entry, as a predicate: any page but `/api` and `/_next`.
function isRefLanding(req: NextRequest): boolean {
  return req.nextUrl.searchParams.has("ref") && !/^\/(?:api|_next)\//.test(req.nextUrl.pathname);
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
 * to the `.rsc` and `.segments/…` transport forms Next adds to every entry
 * (`getMiddlewareMatchers`). Not to any `.` suffix: every request reaches this
 * since PR 794, and `/admin.php` is not a form Next adds.
 */
function isGuardedPath(pathname: string): boolean {
  guardedEntries ??= config.matcher.flatMap((entry) =>
    typeof entry === "string" ? [getPathMatch(entry, { regexModifier: (source) => source.replace(/\$$/, "(?:\\.rsc|\\.segments(?:/.*)?)?$") })] : [],
  );
  return guardedEntries.some((matches) => matches(pathname) !== false);
}
// Compiled on first use: `config` is declared below, so it is not there yet
// while this module's top level runs.
let guardedEntries: ReturnType<typeof getPathMatch>[] | undefined;

// What the request gets before a stale hint is taken off it. `own` is the URL
// as the server received it, which a rewrite must keep (see `guard`).
function route(req: NextAuthRequest, own: URL): NextResponse {
  // The copies' own URLs are answered 404 here, never rewritten again (which
  // minted `/playbooks/cached/cached/…`) nor passed on (which would serve the
  // page a second time under a URL of its own).
  if (isInternalPlaybooksPath(req.nextUrl.pathname)) return new NextResponse(null, { status: 404 });
  // M62 (ADR-092): signed in with Google, but the account asks for a second
  // factor and this token has not passed one. Ahead of the library rewrite, which
  // would otherwise serve a first-factor-only session the signed-in live copy. The
  // flag rides the token because this file cannot read the account (ADR-024), so
  // it is current as of the last sign-in or `update()`; the epoch, which
  // `server/auth.ts` checks on every server-side `auth()`, is what revokes.
  if ((req.auth as SessionWithMfa | null)?.mfaPending) {
    const back = encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(new URL(`/signin/verify?callbackUrl=${back}`, req.nextUrl));
  }
  // `/admin` is 404 for anyone who is not an operator, signed out included
  // (`requireAdmin.ts`): a sign-in redirect would confirm the console exists.
  if (!req.auth && req.nextUrl.pathname === "/admin") return new NextResponse(null, { status: 404 });
  // The public library, for everyone: a reader with no session and no query
  // gets the cached copy, anyone else the per-request one (`playbooksReader.ts`).
  // `req.auth` rather than the cookie's presence: a cookie whose session has
  // expired would be answered signed-out by the live page too.
  const library = playbooksRoute(
    req.nextUrl.pathname,
    playbooksReaderFor(Boolean(req.auth), req.nextUrl.pathname, req.nextUrl.searchParams),
  );
  if (library !== null) {
    const target = new URL(own);
    target.pathname = library;
    return NextResponse.rewrite(target);
  }
  if (req.auth) {
    // `req.auth` is the cookie as this file can read it; the server may still
    // refuse it (a moved security epoch), and then needs to know where the
    // person was going (`servedForApp`).
    const forwarded = new Headers(req.headers);
    forwarded.set(REQUEST_PATH_HEADER, req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.next({ request: { headers: forwarded } });
  }
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

// An explicit list for the routes that need a session, with one catch-all
// entry beside it for maintenance mode. A broad negative-lookahead pattern
// alone would guard static assets and the front-door routes (`/`, `/signin`,
// `/signup`) themselves, so the catch-all is an object entry that
// `isGuardedPath` (which reads the string entries) does not see: a request it
// alone brought in is answered by `proxy` before `auth()`. The string entries
// match exactly the `(app)` routes that need a session, plus the invite links:
//   - `/home`             — Home (apps/web/src/app/(app)/home/page.tsx). Not
//     `/home/:path*`: nothing lives under it.
//   - `/plans`            — the plan chooser (`(app)/plans/page.tsx`). It reads
//     the account's own plan, so signed out it could only say "Your plan
//     could not be loaded just now" (KI-2026-10-11-b). Its `?checkout=` rides
//     the callback. A public catalogue for visitors is a separate feature.
//   - `/trips/:path*`     — matches `/trips/:tripId` and the nested notebook
//     routes under `/trips/:tripId/pages/...` (Next.js treats a `:path*`
//     segment as zero-or-more, so the bare prefix matches too, not just
//     children)
//   - `/invite/:path*`   — the invite landing and its look (M27 link 6).
//     NOT to send anyone to /signin — both pages are public — but to bank the
//     token for M11a's gate on the way past (see the handler above).
//   - NOT `/n/:path*` (M58): a public notebook is read by people with no
//     account, and matching it would send each of them to /signin, as `/s/`
//     would be. Like `/s/`, it meets this file only through the `ref` entry
//     below, which banks a channel and asks nobody who they are.
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
//     the channel a launch link names. Not `/api` or `/_next`: no launch link
//     points there.
//   - every page and discovery path, for maintenance mode alone (PR 794). With
//     it off a request it alone matched is passed on untouched, and the landing
//     stays static (ADR-078). NOT `/api`: a matched request with a body is held
//     by Next until the whole body has arrived (up to `proxyClientMaxBodySize`,
//     10 MB, buffered in memory), which would undo `readCapped`'s early
//     cancel on every API write. API maintenance answers in the routes' own
//     seams instead. `/_next` is left out: chunks, images and data need no
//     answer and are the bulk of requests.
export const config = {
  matcher: [
    "/home",
    "/plans",
    "/account",
    // M62: server-rendered with `auth()`, which hands a first-factor-only session
    // a full one, so the second-factor redirect has to be in front of them.
    "/admin",
    "/oauth/authorize",
    "/trips/:path*",
    "/invite/:path*",
    "/playbooks/:path*",
    { source: "/((?!api/|_next/).*)", has: [{ type: "query", key: "ref" }] },
    // PR 794: every page, for maintenance mode. An object entry, so `isGuardedPath`
    // (which reads the string entries) is not widened with it.
    { source: "/((?!api/|_next/).*)" },
  ],
};
