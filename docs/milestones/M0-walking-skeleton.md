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

- [ ] Demo: sign in with Google, create a trip, see it in the list — on the
      deployed Vercel URL, not just localhost.
- [ ] Golden test: dropping the projection table and rebuilding from the event
      log reproduces identical state.
- [ ] Optimistic-concurrency test: two appends to the same stream/seq — one
      wins, one gets a typed conflict result (not an exception leak).
- [ ] Lint wall proven: a test fixture importing `@tc/domain` from UI code
      fails CI.
- [ ] Day-one multi-persona rules visible: `TripCreated` carries `actor_id`,
      and the trip projection has a members list (length 1), not an owner
      column baked into queries.
- [ ] Playwright smoke (auth mocked or test-user) green in CI.
- [ ] Retro note appended to this file.

## Explicitly out of scope

Days, activities, editing, deleting, any second command, any styling beyond
default components, realtime, invitations.
