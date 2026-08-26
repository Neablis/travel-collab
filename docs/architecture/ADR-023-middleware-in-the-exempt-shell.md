# ADR-023: `src/middleware.ts` joins the lint wall's exempt shell

**Status:** Accepted — 2026-08-26
**Deciders:** Mitchell (product/eng), Claude (implementer)
Related: ADR-002 (server/UI boundary), ADR-019 (§ lint wall widened for `.well-known`)
Milestone: `docs/milestones/M15-front-door.md`

## Context

M15 needs `/` to redirect an unauthenticated visitor to `/welcome`. The
implementation that shipped on this branch did it **client-side**:
`apps/web/src/app/(app)/page.tsx` renders `null`, fetches `/api/trips`, gets a
401, sets `unauthenticated`, and a `useEffect` calls
`router.replace("/welcome")`. That costs a round trip and, because
`(app)/layout.tsx` renders `<AppHeader/>` unconditionally, briefly shows a
signed-out visitor the authenticated app chrome above an empty body before
bouncing them.

The correct fix is a Next.js middleware redirect, decided at the HTTP layer
before any page renders. That was **not** built the first time. It was
avoided because `apps/web/src/middleware.ts` would sit under
`apps/web/eslint.config.mjs`'s lint wall (`AGENTS.md`'s server/UI boundary,
CI-enforced via `no-restricted-imports` on `src/**/*.{ts,tsx}`), which as of
this branch's start exempted only `src/server/**`, `src/app/api/**`, and
`src/app/.well-known/**/route.ts` (added by ADR-019). Middleware needs
`auth()` from `@/server/auth` to know whether a request is authenticated —
that import is exactly what the wall exists to block from UI code. Rather
than raise the exemption question, the previous session shipped the worse
design and recorded the middleware option as deferred to a human decision.

Mitchell has now reviewed that deferral and ruled: take the exemption, do the
middleware redirect, and record why the exemption doesn't weaken the wall.

## Decision

**Add `src/middleware.ts` (exact path, not a subtree) to the lint wall's
`ignores` in `apps/web/eslint.config.mjs`.**

### Why this doesn't weaken the wall

The wall's stated purpose (`AGENTS.md`, "The module map"; `apps/web/src/server`
docstring) is to stop **UI** code — components and pages that ship to the
browser — from reaching into server internals or the domain package directly,
instead of going through the API. `src/server` and the API route handlers are
already the "exempt shell": code that is server-only by construction and
therefore outside what the wall is protecting against.

Next.js middleware is the same kind of code. It:

- **Never ships to the browser.** There is no client bundle for it; it has no
  DOM, no React tree, no way to be imported by a component.
- **Runs only on the server**, before a request is routed to a page or a
  route handler.
- Is, in Next.js's own architecture, the third leg of the same server-side
  triad as route handlers and server components with data access — not a
  fourth, weaker category invented for this change.

Adding it to the exempt list therefore extends the shell to code that is
**definitionally server-side**, the same basis every existing entry in that
list already stands on. It does not touch the rule UI code is held to: every
file under `src/components/**` and every page under `src/app/**` (outside
`api/` and `.well-known/**/route.ts`) is bound by `no-restricted-imports`
exactly as before this change. No component gained a new way to reach
`@/server/*` or `@tc/domain`.

### The cost, honestly

The exempt list is now four entries instead of three
(`src/server/**`, `src/app/api/**`, `src/app/.well-known/**/route.ts`,
`src/middleware.ts`). Each addition — even a justified one — makes the next
argument for widening the wall marginally easier to win, because "we already
made an exception" is a weaker starting position than "we never have." That
is a real, cumulative cost, not a hypothetical one: this is the second
exemption added after the wall's initial three (ADR-019 added the
`.well-known` entry for the Flags Explorer's discovery endpoint), and both
times the justification was "this file is server-only but can't physically
live under `src/server/**` or `src/app/api/**`."

**The bounding test for any future addition:** *is this file server-only by
construction* — meaning it cannot execute in a browser at all, not merely
that it's conventionally treated as trusted — *and does its required location
prevent it from living under `src/server/**` or `src/app/api/**`?* Both
`.well-known/**/route.ts` (fixed path required by the Flags Explorer spec)
and `src/middleware.ts` (fixed path required by Next.js's own middleware
convention) satisfy both halves. A file that is merely *convenient* to
exempt — one that could be moved under the existing shell, or one that runs
in the browser under some conditions — does not, and should not be added
here without a fresh ADR making that case explicitly.

### What was verified, not assumed

Auth.js v5 middleware has a known Edge-runtime failure mode when the app's
full auth config (particularly a database adapter, or providers pulling in
Node-only APIs) is imported into the Edge runtime middleware runs in. This
project has no database adapter and uses JWT sessions
(`apps/web/src/server/auth.ts`), which is the configuration that is expected
to work — but that was checked, not trusted:

- `pnpm --filter web build` succeeds. The build does emit two Edge-runtime
  warnings — `jose`'s `CompressionStream`/`DecompressionStream` (used for JWE,
  not the plain JWT this project signs) are flagged as unsupported Node APIs
  — but these are warnings, not build failures, and nothing in the request
  path this middleware exercises touches them.
- A production server (`pnpm --filter web start`) serves a real 307 redirect
  from `/` to `/welcome` for a signed-out request, and `/welcome` itself still
  serves 200 with no redirect loop — see the PR's verification section for
  the exact `curl` output.
- The full front-door e2e spec (`e2e/m15-front-door.spec.ts`), which drives a
  real sign-in through the dev-login provider, passes against the production
  build.

No restructuring of `server/auth.ts` was needed. The split-config pattern
(an Edge-safe `auth.config.ts` without Node-dependent providers, imported by
both middleware and the main auth instance) is the documented remedy if this
ever breaks — e.g. if a future provider or a database adapter is added — but
it is not needed today and was not built speculatively.

## Alternatives rejected

- **Keep the client-side redirect** (what this ADR replaces). Simpler in that
  it needed no lint-wall change, but it is strictly worse for every signed-out
  visitor: an extra round trip to `/api/trips`, and a visible flash of
  authenticated chrome (`AppHeader`) over an empty page before the bounce.
  This was the design that shipped first, specifically *because* raising the
  exemption question was avoided rather than because it was the better
  design — see `docs/plans/2026-08-26-M15-front-door.md`'s "Known risk,
  deliberately taken" note for the original reasoning.
- **Route auth through an API call inside middleware instead of importing
  `@/server/auth` directly** (e.g. middleware calls its own `/api/auth/session`
  endpoint over HTTP). Would have avoided the import and thus the exemption,
  but adds a network round trip *inside* middleware on every matched request,
  defeating the latency reason for doing this at the middleware layer at all,
  and duplicates logic Auth.js already provides as a first-class middleware
  wrapper (`auth((req) => ...)`).
- **Widen the wall's exemption to all of `src/middleware.ts` and any future
  middleware-adjacent helper files** (e.g. a `middleware/` directory). Rejected
  as broader than the actual need: there is exactly one middleware file
  Next.js will ever run (`src/middleware.ts` is a fixed, singular entry
  point), so an exact-path ignore is the narrowest exemption that satisfies
  the requirement, with no subtree for anything else to hide in.

## Consequences

- `apps/web/eslint.config.mjs`'s lint-wall `ignores` gains `src/middleware.ts`
  (exact path).
- `scripts/check-lint-wall.mjs` is **not** extended with a fixture asserting
  this exemption. Its existing fixtures write throwaway files under
  `apps/web/src/app/__*__.tsx` and delete them; the middleware ignore is an
  exact path (`src/middleware.ts`), so a fixture-based assertion would have to
  overwrite the real middleware file to test against that exact path, which is
  destructive to a file that isn't a fixture. The assertion for this
  exemption instead **is** the real `src/middleware.ts` importing
  `@/server/auth` while `pnpm lint` passes — a standing, permanent proof
  rather than a synthetic one.
- `/` redirects at the HTTP layer instead of after a client round trip. The
  client-side `unauthenticated` → `router.replace("/welcome")` path in
  `(app)/page.tsx` is kept, narrowed to its real remaining job: a session that
  **expires while the page is already open** still 401s on a later
  `/api/trips` fetch, and that visitor still needs to land on `/welcome`.
  Middleware only runs against a fresh request to `/`; it cannot catch an
  in-page expiry.
- The middleware's `matcher` is scoped to exactly `["/"]`. Signed-out access
  to `/trips/:id` and `/playbooks` remains unaddressed by this change — those
  routes still rely on their own server-side/API auth checks — and is
  explicitly out of scope here, not silently dropped.
