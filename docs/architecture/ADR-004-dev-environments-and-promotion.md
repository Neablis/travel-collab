# ADR-004: Local development, environments, and promotion to production

**Status:** Accepted — 2026-07-07
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

Production is Vercel serverless + Neon Postgres (ADR-002) — prod is *not* a
container, so Dockerizing the app locally pays the container tax (slow macOS
file-watching/HMR, volume juggling, harder debugging) while buying zero
serverless parity. The real dev/prod differences are: process model
(long-lived dev server vs cold-starting functions), database connection
behavior, and Postgres version drift. Separately, the command pipeline
requires interactive transactions (append events + update projections
atomically), which Neon's HTTP driver does not properly support.

Options: (A) hybrid — native app, Docker for stateful deps; (B) fully
Dockerized dev; (C) fully native with Homebrew Postgres.

## Decision

**Option A — hybrid.** Onboarding is: `docker compose up -d` (Postgres,
version-pinned to Neon's major) + `.env.local` from `.env.example` +
`pnpm dev`.

Supporting decisions:

- **Database access:** node runtime + plain `pg` driver over TCP everywhere;
  prod uses Neon's **pooled connection string** (PgBouncer). **No edge
  runtime** — the transaction requirement forbids it. Same driver and Drizzle
  code in dev, CI, and prod.
- **Promotion pipeline:** local (native app + Docker PG) → CI (identical test
  suite, PG service container as the neutral referee) → **Vercel preview
  deployment per PR** (the true serverless-parity environment; pair with a
  Neon dev/branch database) → production (Vercel + Neon main).
- **Migrations** run via drizzle-kit as an explicit CI/deploy step — never
  implicitly at cold start.
- Anything suspected serverless-shaped (cold start behavior, request
  lifetime, connection reuse) is verified on a preview deployment, not
  localhost.

## Consequences

- Fast local iteration for agents and Mitchell; disposable local DB makes the
  drop-projections-and-replay workflow (constant under event sourcing) a
  one-liner.
- We rely on CI + preview deploys, not environment identity, for confidence —
  the milestone e2e scripts must therefore stay green in CI, and gates demo
  on deployed URLs (already required by M0).
- Rejected B: hermetic multi-machine dev wasn't a requirement; revisit only
  if development regularly spans machines/devcontainers.
- Rejected C: machine-state pollution and version drift vs Neon.
