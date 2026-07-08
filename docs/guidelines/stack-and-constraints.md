# Stack and constraints

## The stack (ADR-002 is authoritative; this is the working summary)

- **TypeScript strict everywhere**; pnpm workspaces monorepo.
- **Next.js all-in-one** (App Router) on Vercel — UI and server in one app,
  separated by the lint wall (`src/server/**` only may import `@tc/domain`).
- **Postgres** — Docker locally, Neon in prod; **Drizzle** ORM + migrations.
- **Auth.js** with Google OAuth (no other providers until asked).
- **Zod** in `packages/contracts` for every cross-boundary type.
- **MapLibre GL** + OSM/Protomaps tiles (M3+). **TipTap** presumptive (M5+).
- **Vitest** (+ fast-check) for unit/integration; **Playwright** for e2e;
  **MSW** for UI-against-mock development.

## Hard constraints (violating these needs Mitchell's sign-off first)

1. **Free tier.** No service or dependency that requires payment. If a task
   seems to need one, stop and surface it with alternatives.
2. **Serverless limits.** No WebSockets from Vercel functions; no background
   daemons; projection updates must complete within the request. Long-running
   work is a design problem to escalate, not a `setInterval` to hide.
   **No edge runtime** — the command pipeline needs interactive transactions;
   node runtime + `pg` driver + Neon pooled connection string only (ADR-004).
3. **No new runtime dependencies without justification.** Each new package
   gets one sentence in the PR: what it does, why not stdlib/existing deps.
   Prefer boring, popular, typed libraries.
4. **Events are forever.** Never edit or delete rows in the event store; never
   "fix" history — append. Schema changes to events require a version bump and
   an upcaster (see building-the-parts).
5. **Secrets never in git.** `.env.local` only; document required vars in
   `.env.example`.
6. **The three multi-persona rules** (actor_id on every event; members list,
   never owner-singletons; AccessPolicy for every permission check) apply to
   ALL code, including throwaway-feeling Phase 1 features.

## Local development and promotion (ADR-004)

- **Local:** `docker compose up -d` (Postgres, pinned to Neon's major
  version) → copy `.env.example` to `.env.local` → `pnpm dev`. The app runs
  natively; only stateful dependencies live in Docker.
- **DB resets are cheap and encouraged:** dropping projection tables and
  replaying the event log is a standard workflow, not an emergency.
- **CI is the referee:** the identical suite runs against a Postgres service
  container on every PR.
- **Preview deployments are the parity environment:** every PR gets a Vercel
  preview URL; anything serverless-shaped (cold starts, connection reuse,
  request lifetime) is verified there, never assumed from localhost.
- **Migrations** run as an explicit drizzle-kit step in CI/deploy — never
  implicitly at app startup.

## Known accepted trade-offs (don't relitigate; don't be surprised)

- Client/server separation is lint-enforced, not process-enforced — chosen
  eyes-open vs a separate API service (ADR-002).
- Realtime at M6 will need a bolt-on or a `src/server` extraction — designed
  for, deferred.
- Phase 1 has zero network effects; validation is dogfooding.
