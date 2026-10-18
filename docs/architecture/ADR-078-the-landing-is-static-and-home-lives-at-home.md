# ADR-078: `/` is a static page, and Home lives at `/home`

**Status:** **Accepted — 2026-10-18.** Mitchell approved the move that day, knowing the measured
cost it removes (below).
Amends **ADR-023** and **ADR-024**'s description of `/` (the proxy no longer sees it), and the SEO
pass's **D9** (`docs/specs/2026-10-02-seo-pass-design.md`): the landing is still served at `/`,
but to everybody, and `/welcome` now redirects there instead of being canonical to it.
**Deciders:** Mitchell (product); Claude — drafted
Related: ADR-024 (the edge-safe Auth.js instance the proxy builds), ADR-061 (the public library
is readable without an account), ADR-077 (the proxy picks the library's cached or live copy), and `docs/candidates.md`'s *"The signed-in app moves from `/`
to `/home`"*, where the 17 ms was measured (PR 485's session).

## Context

`/` was two pages. For a signed-out request `src/proxy.ts` rewrote it to `/welcome`, the landing;
for a signed-in one it served Home from `(app)/page.tsx`. Because one URL answered with two
documents by session, every response for `/` carried `Cache-Control: private, no-store`
(D9's own constraint: a visitor who signs in must never be shown the landing from a cache).

That made the most-visited URL the most expensive one:

- Every request ran Auth.js's edge `auth()` in the proxy before anything else — about **17 ms of
  TTFB, measured** — including the crawler's and the first-time visitor's, who have no session.
- The landing could not be prerendered for anyone: no CDN copy, no browser cache, and
  `no-store` also keeps the page out of the back-forward cache.

## Decision

1. **Home moves to `/home`** (`(app)/home/page.tsx`). Every link, redirect and fallback that
   means "your trips" names one constant, `HOME_PATH` (`src/lib/homePath.ts`): the logo, the
   account menu's *Trips*, the phone tab bar, ⌘K's *Go to Home*, every "Back to your trips",
   `safeCallbackUrl`'s fallback and so sign-in's default destination, and Stripe's portal
   `return_url`. The installed app's `start_url` is `/home`, with `id: "/"` so existing installs
   keep their identity (it defaulted to the old `start_url`).

2. **The landing is `(front)/page.tsx`, at `/`, and is static** — `○` in `next build`. It reads
   no cookie and no header. The proxy's matcher is `["/home", "/trips/:path*", "/invite/:path*", "/playbooks/:path*"]`
   (the last for ADR-077's copy, never a sign-in);
   `/` is not on it, and the rewrite and its `no-store` are gone. A signed-out `/home` takes the
   existing branch: `/signin?callbackUrl=%2Fhome`.

3. **`/welcome` is a 308 to `/`**, from `next.config.ts` `redirects()`, not the proxy. Links to
   it exist outside the app; the sitemap, robots and `llms.txt` already name `/`.

4. **A signed-in browser on `/` is sent on by a hint cookie and an inline script.** The Auth.js
   session cookie is HttpOnly, so a script cannot see it, and a static page cannot ask the
   server. So:
   - **The app shell is the only setter.** `SessionUserProvider` (keyed on the user id) sets
     `tc_signed_in=1` from the browser — not HttpOnly, `Path=/`, `SameSite=Lax`, Secure on https,
     the session's 30-day life — once it knows a session user. Every page a signed-in person reads
     renders it with the served user: everything under `(app)` (`/home`, `/trips/*`, `/plans`,
     `/account`) and the library's live copy (`app/playbooks/live`). So the hint appears after
     hydration, not on the first response. `/invite/*` has no shell and does not set it; an
     invite hands off to a trip page, which does.
   - **The proxy only deletes it**, on any matched request with no session — the library's
     cached copy included. It never sets it.
   - Both sign-out buttons, and Home when its read answers 401, delete it before they leave. The
     delete also stops the browser setter for the rest of that document.
   - `LEAVE_LANDING_IF_SIGNED_IN` (`src/lib/sessionHint.ts`), inline in the root layout's
     `<head>`, does `location.replace("/home")` when the path is `/` and the hint is present —
     before the landing paints. There is no header link and no server check.

   The hint authorises nothing. A stale or forged one costs one hop: `/` → `/home` → the proxy
   finds no session, sends the visitor to sign in and deletes the hint. It cannot loop.

## Two details the design did not say, settled while building it

- **The script is in the root layout, not the landing page.** React never runs a `<script>` it
  renders on the client, so on a client navigation to `/` (the front-door logo from `/signin`)
  the landing's own tag would be dead, and in development it logs a console error. The layout's
  `<head>` is sent once per full load and never re-rendered — the only case a script can act in
  anyway — and the script checks the path, so it is a no-op everywhere else. The CSP already
  admits inline scripts (`next.config.ts`; `EARLY_INSTALL_LISTENER` is the precedent).
- **The proxy does not set the hint (Mitchell, 2026-10-18).** It did at first, on a signed-in
  matched request. Set on every one, a client-router prefetch — sent when the account menu's
  *Trips* link renders — answered after sign-out had deleted the hint and put it back, so the
  landing sent the visitor to `/home` and then to sign in: 6 of 10 runs of
  `e2e/m15-front-door.spec.ts`'s sign-out. Filtering to page loads by the browser's
  `Sec-Fetch-Dest` fixed it for current browsers but left the race on any that do not send the
  header (Safari before 16.4), and the proxy alone missed a sign-in that lands on a page it does
  not match (`/plans`, `/account`). Once every matched page a signed-in person reads rendered the
  app shell with the served user (PRs 485, 487 and 489), the shell's setter covered everything
  the proxy's did, so the proxy's set went. With no response able to set the hint, nothing in
  flight can put it back after sign-out, and `clearSignedInHint` stops the shell's setter for the
  rest of that document.

## Options not taken

- **A proxy rewrite of a signed-out `/` to a cached landing**, as ADR-077 does for the library.
  It keeps the edge `auth()` (~17 ms) on every visit to `/`, which is the cost this ADR removes.
  And one URL that answers two documents by session must stay `private, no-store`, out of the
  browser cache and the bfcache, or a visitor who just signed in is shown the landing from
  cache (D9's hazard).

## Consequences

- `/` is cacheable by a CDN, the browser and the back-forward cache, and pays for no `auth()`.
  `e2e/seo.spec.ts` asserts the absence of `private` and `no-store`.
- `/home` pays the proxy's `auth()` instead, as `/trips/*` always has.
- **The sign-out race the old `/welcome` callback worked around is gone.** It existed because `/`
  was Home for a request whose session cookie had not yet been cleared. `/` no longer reads the
  session, so sign-out goes to `/`.
- **A signed-in browser with no hint sees the landing until it opens an app page.** The shell
  sets the hint on every page under `(app)` and the library's live copy, however it was reached,
  so what is left is an account that signed in before this shipped and has opened no app page
  since, or a browser that has seen only `/demo/…`, `/s/…` or `/invite/*` since signing in. Its
  `/` shows the landing, whose *Sign in* takes them in.
- **The hint arrives after hydration, not with the first response.** A browser that leaves the
  first app page it opens before its scripts run has no hint yet; the next app page sets it.
- **A client navigation to `/` while signed in goes on to Home too.** The head script runs on a
  full load only. The landing's own effect (`LeaveLandingIfSignedIn`) covers a client navigation
  and Back within a document — the not-found page's *Caesura home*, Back from `/signin`, the
  front-door logo — and, through a `pageshow` listener kept with the page, a back-forward-cache
  restore. It leaves with `location.replace`, a full load of request-rendered Home, so the landing
  stays on screen until Home's response commits: a server render behind `auth()` and database
  reads, hundreds of milliseconds on a cold function, not one frame. A full load rather than
  `router.replace` because it goes through the proxy, which clears a stale hint. On a full load
  of `/` the head script has already left, so the effect skips its first mount in that document
  rather than request Home a second time. The `pageshow` check is not in the head script because
  growing the root layout's HTML by even 84 bytes turned `e2e/seo.spec.ts`'s "same 404 with the
  same body" red (KI-2026-10-18-e).
