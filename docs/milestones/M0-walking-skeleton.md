# M0 — Walking skeleton

**Goal:** the thinnest possible end-to-end thread through the real architecture.
A signed-in user creates a trip in the browser; that action travels
`UI → typed client → route handler → command pipeline → event appended →
projection updated → trips list renders`. Everything after M0 is "more of the
same," never "new kind of plumbing."

## Scope

- pnpm workspaces monorepo: `packages/contracts`, `packages/domain`, `apps/web`;
  shared root-level tsconfig and eslint config with boundary rules (UI may not
  import domain or server internals).
- docker-compose Postgres (major version pinned to Neon's); Drizzle
  migrations applied as an explicit step, never at runtime; `.env.example`
  documenting every required variable (ADR-004).
- Vercel project wired for preview deployments per PR; production deploy from
  `main` with a Neon pooled connection string, node runtime only.
- **Event store** in `apps/web/src/server`: `events` table
  (`stream_id, seq, type, payload, actor_id, occurred_at`), append with
  optimistic concurrency on `(stream_id, seq)`, read-stream, read-all.
- **Domain**: `Trip` aggregate with exactly one command — `CreateTrip`
  (name, date range) → `TripCreated` — plus the reducer and a `tripSummary`
  projection function. Deliberately minimal; M1 adds the rest.
- **Contracts**: Zod schemas for the command, event, DTOs, and the (empty for
  now) `Conflict` type so its shape exists from day one.
- **Web**: Auth.js Google sign-in; "create trip" form; trips list rendered from
  the projection. Deployed to Vercel with Neon Postgres.
- **CI** (GitHub Actions): typecheck, lint, unit, integration with Postgres
  service container, Playwright smoke.

## Exit gate — all must be true

- [x] Demo: sign in with Google, create a trip, see it in the list — on the
      deployed Vercel URL, not just localhost.
- [x] Golden test: dropping the projection table and rebuilding from the event
      log reproduces identical state.
- [x] Optimistic-concurrency test: two appends to the same stream/seq — one
      wins, one gets a typed conflict result (not an exception leak).
- [x] Lint wall proven: a test fixture importing `@tc/domain` from UI code
      fails CI.
- [x] Day-one multi-persona rules visible: `TripCreated` carries `actor_id`,
      and the trip projection has a members list (length 1), not an owner
      column baked into queries.
- [x] Playwright smoke (auth mocked or test-user) green in CI.
- [x] Retro note appended to this file.

## Retro (2026-07-08)

Shipped the full thread end-to-end: Google + Dev Login sign-in, create-trip
through the command pipeline, event append with optimistic concurrency,
live projection, golden rebuild test, CI, and a working Vercel + Neon
production deploy.

**What changed vs. the plan:**
- **Local port conflicts.** Both Postgres (5432) and the Next.js dev server
  (3000) collided with an unrelated `reactive_resume` project's Docker
  containers already running on this machine. Moved local Postgres to 5433
  and the web app's dev/start port to 3001; CI keeps the plan's original
  5432/3000 since GitHub-hosted runners don't have that conflict.
- **Branch strategy.** Executed the plan in an isolated git worktree/branch
  rather than directly on `main` (Mitchell's call, via `superpowers:using-git-worktrees`).
  This meant Task 12's CI verification and Task 13's Vercel root-directory
  fix both needed a PR merge to `main` first — the plan assumed a single-branch
  flow and didn't anticipate this.
- **Playwright hydration race.** The plan's e2e script clicked "Create trip"
  immediately after filling the form. In dev/prod Next.js, the pre-hydration
  DOM already shows the authenticated UI shell, so the click could land before
  React attached the `onSubmit` handler, firing a native form GET instead of
  the fetch call. Fixed by waiting for the first authenticated `GET /api/trips`
  response (only fires post-hydration) before interacting with the form.
- **`next/link` vs `<a>`.** The plan's sign-in link used a raw `<a>`, which
  trips `@next/next/no-html-link-for-pages`. Swapped to `next/link`'s `Link`.
- **Auth.js `AUTH_TRUST_HOST` in CI.** `next start` (which CI's e2e step runs)
  rejects requests from untrusted hosts unless the platform sets this itself
  (Vercel does automatically; a bare CI runner doesn't). Added
  `AUTH_TRUST_HOST=true` to the CI workflow env — not needed for the actual
  Vercel deploy.
- **Vercel Framework Preset stuck on "Other."** The project was first imported
  with a blank Root Directory, so Vercel couldn't detect Next.js and defaulted
  the Framework Preset to "Other" — which persisted (looking for a static
  `public/` output) even after Root Directory was corrected to `apps/web`,
  causing every subsequent build to fail with "No Output Directory named
  'public' found." Fixed via the Vercel API (`PATCH .../projects/travel-collab
  {"framework":"nextjs"}`), diagnosed and applied using the official `vercel`
  CLI and REST API with a Personal Access Token Mitchell generated — this was
  far faster and more precise than debugging through UI descriptions alone.
- **Vercel preview deployments** were unverified until a throwaway test PR
  confirmed the git integration actually builds preview deployments (gated
  behind Vercel's own SSO protection for preview URLs, which is expected).

**What M1 should know:**
- The port-conflict pattern (another local project squatting on a default
  port) is likely to recur — check `docker ps` / `lsof` early if a service
  won't bind.
- If future milestones need a Vercel dashboard change, the API + CLI +
  Personal Access Token path is faster than screen-sharing descriptions back
  and forth — worth reaching for it earlier next time.
- The command pipeline, event store, and lint wall all held up exactly as
  designed — no invariant needed bending to ship M0. The friction was entirely
  in local environment quirks and one third-party platform config bug, not
  the architecture.

## Explicitly out of scope

Days, activities, editing, deleting, any second command, any styling beyond
default components, realtime, invitations.
