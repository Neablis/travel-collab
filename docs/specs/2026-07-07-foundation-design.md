# Foundation design — travel-collab

**Date:** 2026-07-07 · **Status:** Approved by Mitchell (decisions 1–7);
architect defaults in §4–§6 stand unless Mitchell overrides.
**Companions:** ADR-001/002/003, `AGENTS.md`, `docs/milestones/`,
`docs/guidelines/`

## 1. Product thesis

A collaborative travel-planning platform. A vacation is an "Epic" — a trip
with days and activities. Groups plan together with an immutable change
history (undo, revert), fork trips with lineage, resolve conflicts (scheduling
and concurrent-edit) as first-class data, and eventually share plans to a
community that can clone and adapt them. Rich layer on top: Notion-style trip
pages with embedded primitives, output lenses (itinerary, daily overview),
cost rollups, calendar integration, AI generation.

**Purpose:** learn by shipping — build the differentiating core (event
sourcing, conflict engine) ourselves; buy commodity capabilities (auth, maps).
**Constraints:** solo developer + AI agents; free-tier operating cost.

## 2. Decision log (all explicitly made by Mitchell, 2026-07-07)

| # | Decision | Alternatives rejected |
|---|---|---|
| 1 | Learn by shipping: build core, buy commodity | pure-product speed; pure-learning DIY |
| 2 | Event-sourced, near-real-time collaboration model (ADR-001) | git-style explicit commits; full CRDT |
| 3 | Next.js all-in-one on Vercel (ADR-002) | Vite SPA + Hono API (architect's pick); Remix/RRv7 |
| 4 | History substrate **scoped to the planning domain** (ADR-003) | whole-app event sourcing; history as peer module (dual-write trap); snapshot-per-change |
| 5 | Phase 1 = **full single-player product**, gated by dogfooding a real trip | minimal-core-then-collab; dogfood-driven depth |
| 6 | Module map with AccessPolicy seam (AGENTS.md) | — |
| 7 | Fork = clone-with-lineage; merge = guided cherry-pick; no three-way structural merge until demanded | full git-style merge |

Standing principles: **conflicts are data, not errors**; **clear functional
separation** (modules own their data, reference by ID); **single-player now,
multi-persona always** via three day-one rules — every event carries
`actor_id`; no "the user" singletons (a trip has a members list, of one); all
permission checks route through the `AccessPolicy` seam.

## 3. Scope challenges accepted into the design

- The original vision bundles ~5 products (planning core, version control for
  structured data, collaborative editor, community platform, integrations).
  The phase/milestone gates decompose it so each ships and hardens before the
  next begins.
- Merge-conflict UX is hostile to non-technical users → decision 7. The event
  log preserves the raw material (per-fork histories with a common ancestor)
  to build real merge later if users demand it.
- Community features imply trust & safety obligations; quarantined in M9.
- Phase 1 has zero network effects — validation is personal utility only.
  Accepted deliberately: collaboration later lands on a product people want to
  be invited into, on a core hardened by real use.

## 4. Domain vocabulary (architect defaults — flag disagreements early)

- **Trip** — title, *optional* date range (undated "someday" trips are valid;
  days are ordinals until dates are pinned), members list with roles (length 1
  in Phase 1), lineage pointer (`forkedFrom: {tripId, atSeq}`), visibility
  (private until M9).
- **Day** — ordinal within trip + optional calendar date (derived when the
  trip range is pinned; shifting the range re-derives dates and re-runs the
  conflict engine — the "drag the vacation" behavior).
- **Backlog** — activities may belong to the trip without a day (ideas pool),
  jira-style; planning = dragging backlog items onto days.
- **Activity** — title; optional day; optional time window; optional location
  (place name + geocoded point); optional cost estimate; **anchors**
  (constraints like "must fall on a public holiday", "only Mon–Fri",
  "market open 08:00–13:00") — the source of soft conflicts when dates shift;
  free-text notes.
- **Time semantics:** activity times are *local wall-clock at the activity's
  location*, stored as local datetime + IANA zone id. Travelers think "9am in
  Rome"; UTC-normalizing would corrupt intent when activities move between
  places.
- **Conflict** — `{ id, kind, severity: info|warn|error, subjects[],
  description, resolutions[] }`. Never blocks a write; persisted as a
  projection and shown until resolved or dismissed.
- **Commands/Events** — per aggregate, versioned, e.g. `CreateTrip →
  TripCreated`, `MoveActivity → ActivityMoved`. Events carry `actor_id` and
  are immutable forever (upcasters handle schema evolution).

Initial conflict rule set (M1, expanded per milestone): time-window overlap
within a day; same-day geographic infeasibility (distance/gap heuristic —
"you can't visit Rome and NYC at the same time"); date-anchor violations
(M3, when anchors land).

## 5. Event-store mechanics (architect defaults)

One stream per trip. Table: `events(global_seq bigserial, stream_id, seq,
type, version, payload jsonb, actor_id, occurred_at)` with a unique index on
`(stream_id, seq)` — optimistic concurrency: append with expected `seq`,
unique-violation returns a typed conflict result. Projections update
synchronously within the request in Phase 1 (serverless-friendly); snapshots
deferred until replay latency demands them. Rebuild-from-log is a golden test
from M0 onward.

## 6. UX surface for Phase 1 (architect default, product call — easy to veto)

Primary planning view is a **day-column board** (jira-like: backlog column +
one column per day, drag activities between them). Calendar and timeline/map
views arrive in M3 as alternate lenses over the same projections. Rationale:
the board maps 1:1 onto the command vocabulary and defers the hardest
calendar-drag interactions until history (M2) exists to make experimentation
safe.

## 7. Structure, testing, process

See `AGENTS.md` (module map, invariants, workstreams, definition of done),
`docs/guidelines/` (how to build/connect/validate/enforce quality),
ADR-002 (stack), `docs/milestones/README.md` (phases and gates), `TODO.md`
(high-level roadmap checklist).

## 8. Open questions (deferred, tracked)

- Realtime transport at Phase 2/M7 — bolt-on (Supabase Realtime/Pusher) vs
  `src/server` extraction. ADR due at M7 start.
- Rich-text editor at M6 (TipTap presumptive; embeds M10).
- Facebook OAuth: deferred; Google-only until users ask.
- Whether membership changes are mirrored into trip streams for the activity
  feed (Phase 2).
- Community moderation policy details (M9).
