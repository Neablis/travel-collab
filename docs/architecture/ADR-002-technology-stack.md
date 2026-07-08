# ADR-002: Technology stack

**Status:** Accepted — 2026-07-07
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

Constraints: solo developer plus AI agents; free/hobby-tier operating cost;
"learn by shipping" — build the differentiating core (event sourcing, conflict
engine) ourselves, buy commodity capabilities.

App-framework alternatives compared before deciding (2026-07-07):

- **Vite + React SPA + Hono API, one Node deployable** — strongest physical
  client/server separation and trivial WebSockets later; costs more assembly
  and an always-on host (Render free-with-sleep or ~$5/mo).
- **Remix / React Router v7 framework mode** — plain Node server, clean
  loader/action model; smaller ecosystem, recent churn.
- **Next.js all-in-one on Vercel** — best deploy story and most agent-familiar;
  client/server blend must be disciplined by lint rules; serverless cannot hold
  WebSockets.
- SvelteKit and TanStack Start ruled out (ecosystem depth; maturity).

Mitchell chose **Next.js all-in-one**, accepting the two costs eyes-open: the
separation principle is enforced by a CI-verified lint wall rather than a
physical process boundary, and Phase 2 realtime will require a bolt-on
(e.g. Supabase Realtime/Pusher) or a server extraction.

## Decision

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript strict, everywhere | One language across all agent workstreams; inferred types from Zod schemas *are* the contracts |
| Monorepo | pnpm workspaces | Boring, sufficient; Turborepo optional later |
| App | **Next.js all-in-one** (UI + route handlers/server actions) on Vercel free tier | Single deployable, zero infra work; boundary discipline preserved via the `src/server` lint wall (see ADR-001 / AGENTS.md) |
| Database | Postgres — Docker locally; **Neon** free tier in prod (serverless driver) | Event store + projections in one durable place; Neon over Supabase because we only need Postgres (auth is Auth.js), minimizing platform gravity |
| DB access | Drizzle ORM + drizzle-kit migrations | Type-safe SQL without heavy abstraction; good fit for a hand-rolled event store |
| Auth | Auth.js with Google OAuth (Facebook later if wanted) | Commodity — buy via library; native Next.js integration |
| Validation/contracts | Zod in `packages/contracts` | Runtime validation + inferred static types from one definition |
| Maps | MapLibre GL + OpenStreetMap/Protomaps tiles | Genuinely free; Mapbox is the paid upgrade path if polish demands it |
| Unit/integration tests | Vitest (+ fast-check for property-based) | Fast, TS-native |
| E2E | Playwright | Milestone gate scripts |
| API mocking for UI work | MSW, driven by contract schemas | Lets the UI agent build against mocks before server exists |
| CI | GitHub Actions: typecheck, lint, unit, integration (Postgres service), e2e smoke | Free for public/small repos |

## Deferred decisions (each gets its own ADR when its milestone arrives)

- **Realtime transport (Phase 2, M6):** Vercel serverless does not hold
  WebSockets. Candidates: Supabase Realtime, Pusher/Ably free tier, or
  extracting `src/server` to a small always-on host and using plain
  WebSockets/SSE. This is the known pressure point of the all-in-one choice;
  the extraction path is designed-in and cheap.
- **Rich-text editor (M5):** TipTap/ProseMirror is the presumptive choice for
  the basic trip notes page; custom embed nodes arrive at M9.
- **AI integration (M5):** Claude API emitting domain *commands* through the
  standard validation pipeline — never raw writes. Details at M5.

## Consequences

- Fastest possible path to a deployed product; one `git push` deploys.
- We accept serverless constraints (cold starts, no long-lived connections,
  projection updates must complete within request lifecycles or move to a queue).
- If the app outgrows Vercel, `apps/web/src/server` extracts into a standalone
  service; `packages/domain` and `packages/contracts` are unaffected by design.
