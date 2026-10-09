# System design — as built

**As of 2026-10-05, `main` at `498530ce` (M34 current).** How the system behaves and why: the flows, the
rules, the trade-offs, and where prose and code disagree. It does not restate the ADRs; it tells you which one to
open.

**It deliberately holds no inventories** (packages, tables, routes, dependency versions). Those can be derived from
source, and a hand-written copy is the part that goes stale. §2 says where to get each one. The generated map
designed in `docs/specs/2026-09-18-architecture-map-and-drift-audit-design.md` is the intended home for them; it is
not built yet.

How to read it:

- **Authority.** Code beats this file; this file beats older prose. Where an ADR, `AGENTS.md` or the foundation
  spec says something the code no longer does, §12 lists it.
- **Citations** are file paths and constant names, not line numbers, so they survive edits. Paths starting `src/`
  are under `apps/web/`.
- **Provenance.** §1–§10 were read from code. §11 is condensed from the ADRs. A handful of load-bearing constants
  were re-checked by hand (poll interval, retry count, grace window, step cap). §13
  lists what nobody verified.
- **Staleness.** Nothing checks this file. Named constants rot first; the shapes in §3–§5 rot slowly.

---

## 1. What it is

A collaborative trip planner (public brand `caesura.today`). A trip is days, stops ("activities") and an
unscheduled backlog. Every planning change is an immutable event, which is what buys undo, redo, revert to any
point, history preview, pinned read-only share links and clone-with-lineage. Scheduling problems are soft
*conflicts* carried as data, never blocking errors.

Around that core: membership with four roles, suggestions held for review, a notebook of pages built from
computed widgets, a personal and public library of reusable "playbook" days, an AI assistant that proposes
changes for a human to approve, paid plans through Stripe, and a scoped public REST API.

Standing constraints that explain most decisions below: one developer plus agents, and free-tier operating cost
(`docs/guidelines/stack-and-constraints.md`). Serverless only: no WebSockets, no daemons, no scheduler.

## 2. Where the inventories live

| You want | Read or run |
|---|---|
| Module and package dependency graph | `pnpm arch:graph` (Mermaid, on demand) |
| The boundary rules, as enforced | `.dependency-cruiser.cjs` (`pnpm arch`), `apps/web/eslint.config.mjs`, `scripts/check-lint-wall.mjs` |
| The module map (owns / storage / does not know about) | `AGENTS.md`, "Architecture map and dependency rules" |
| Tables and columns | `apps/web/src/server/db/schema.ts`; migrations in `apps/web/drizzle/` |
| Commands, events, DTOs | `packages/contracts/src/` |
| Public API routes and shapes | the generated `openapi.json` (`pnpm --filter web openapi:generate`), served at `/api/v1/openapi` |
| Which internal routes are exposed publicly | `src/server/public-api/exposure.ts` |
| Stack and versions | the `package.json` files |
| Environments, deploys, migrations | `docs/guidelines/environments-and-deploys.md` |
| Test lanes and what counts | `docs/guidelines/testing.md`, `AGENTS.md` Definition of Done |
| What is known broken | `docs/known-issues/open/` |
| Where the work is | `pnpm state`, `docs/STATUS.md` |

## 3. Shape

One Next.js app (`apps/web`: UI, internal BFF routes, public API, server modules) on Vercel, one Postgres, and a
few workspace packages. The dependency direction is the design:

```
@tc/contracts  ◄──  @tc/domain  ◄──  apps/web/src/server  ◄──  route handlers
 Zod schemas        pure core:        the only code that
 (depends on        decide, evolve,   may import domain
  nothing)          fold, conflicts
                         ▲
                    @tc/predict  ◄──  UI (optimistic prediction only)
```

- **`@tc/domain` is pure**: no I/O, time passed in. That is what makes replay, the golden rebuild test and
  client-side prediction possible.
- **UI may not import `@tc/domain` or `@/server/*`.** The one sanctioned door is `@tc/predict`, a one-line
  re-export of the decider and reducer, so the browser predicts with the server's own code (ADR-013).
- **The split is enforced by lint and dependency-cruiser, not by a process boundary** (accepted in ADR-002).
  Sole-writer tests cover the tables where one writer matters.
- **Only two things are event-sourced: trip planning and notebook pages**, and they share one stream per trip.
  Everything else (identity, access, suggestions, library, entitlements, billing, the AI ledger) is CRUD
  (ADR-003). Access is CRUD that is *overlaid on the read*, never written into the projection.
- **The assistant is a kernel** (`src/server/assistant/`) that imports no `next`; `src/server/ai/` is its wiring.
  Only `modelSelection.ts` may reach the gateway client.
- Identity, Entitlements and Billing know nothing about trips.

`AGENTS.md`'s module table has no row for the notebook or the assistant (§12).

## 4. Data model rules

Conventions in `src/server/db/schema.ts`: **no foreign keys** (one exception inside suggestions), user references
are bare `text` Auth.js ids, and jsonb is parsed at the read boundary because `$type<T>()` is only a compile-time
cast.

### The event log

- **One table, one stream per trip** (`stream_id = tripId`). Notebook page events ride the same stream and the
  same `seq`.
- **Concurrency is one unique index**, `(stream_id, seq)`. `appendToStream` writes `expectedSeq + 1 + i`; a `23505`
  comes back as `concurrency-conflict`. No locks. Seqs are contiguous `1..N`.
- **Envelope**: `streamId, seq, type, version, payload, actorId, occurredAt, batchId, origin`. `origin` is
  provenance: `user | undo | redo | revert | suggestion`.
- **A batch is a history entry.** One `batchId` per command execution; a multi-command batch undoes as a unit.
- **Undo, redo and revert are ordinary commands** that append compensating events. Nothing is ever deleted or
  edited (ADR-005).
- **No snapshots.** Every write reads and folds the whole stream. Only the realtime poll avoids it (`max(seq)`,
  index-only).
- **No upcaster exists yet**, and there is no operator-triggered projection rebuild (open KI).

### Projections

Written only inside the command transaction: `applyTripEvents`, `upsertTripDetail` (whole doc recomputed, conflicts
included), `applyPageEvents`. `rebuildProjections()` truncates and rebuilds summaries and details, and *replays*
`pages` without truncating, because some page rows predate their genesis event. A golden test asserts rebuild
equals stored.

Two things are deliberately **not** in the projection: the effective member list (log owner + `trip_memberships` +
travelling flags, overlaid on every read and command response) and the demo trip (folded in memory from
`@tc/fixtures`, no rows; ADR-031).

### Smaller rules

- **Money** is `{ amountMinor: int ≥ 0, currency: ISO-4217 }`, hundredths for every currency, never a float
  (ADR-008). A stop's price is per person (ADR-060); totals multiply by travellers, not members (ADR-065).
  AI cost is not `Money`: the ledger stores tokens and model ids, priced later against `modelRates.ts`.
- **Soft delete**: a trip is deleted by a domain event (ADR-016); library rows use `deleted_at`; tokens, grants,
  shares and invites use `revoked_at`/status, resolved on read and never swept.
- **Clone** writes a fresh stream from *state*, not from events, remapping every day and activity id; lineage
  lives in `TripCreated` (ADR-017, ADR-028).

## 5. Flows

### 5.1 A planning edit

```
 browser A                              server (one Postgres transaction)                 browser B
 ─────────                              ─────────────────────────────────                 ─────────
 gesture
   │ predictBatch (@tc/predict: the server's own decide + evolve)
   ▼
 optimistic queue ── POST /api/trips/:id/commands/batch ──►  1 Zod-parse
   ▲                                                         2 readStream + fold (whole stream)
   │                                                         3 authorize each command by role
   │                                                         4 decide, each against the previous result
   │                                                         5 appendToStream (expectedSeq = length)
   │                                                         6 projections: summaries + details
   │                                                         7 optional same-transaction hook
   └────────── { detail, history } ◄─────────────────────────8 overlay effective members
 adopt, re-predict rest                                                                    GET …/events?after=seq
                                                                                           every 2 s while visible
                                                                                           news → refetch the trip
```

- **Client queue** (`src/components/trip/context/optimistic.ts`): sequential sender; on rejection the queue is kept
  and nothing more is sent until a manual retry; `pagehide` flushes the whole queue with keepalive. Every unit
  carries its id as a key, which `command_receipts` records with its events, so a resent unit is applied once (ADR-066).
- **Lost append race**: with no `expectedSeq` the server re-runs the whole transaction, `BATCH_APPEND_ATTEMPTS = 3`.
  With `expectedSeq` (public API) the 409 and `currentSeq` are the answer.
- **Realtime is a poll, not push** (ADR-049). `POLL_INTERVAL_MS = 2000`, only for visible trips with more than one
  member or a pending invite. The server answers from the head seq and range-scans only on news, capped at
  `MAX_EVENTS_PER_POLL = 200`, past which it says `resync`. The client treats both as "refetch". The response also
  carries `suggestionsRev` and `accessRev`, so non-planning changes are noticed.
- **Concurrent edits** surface as a client-synthesised `concurrent-edit` conflict in the normal banner
  (`concurrentEdits.ts`).

### 5.2 A read

`apiClient.ts` fetcher (through `queryCache.ts`: in-flight de-dupe plus a short reuse window, ADR-046) →
`GET /api/trips/:id` → `requireTripAccess(tripId, "viewer", …)` → read and parse `trip_details.doc` → overlay
effective members. Trip reads never fold; history, time-travel and pinned shares do. Most pages are client
components that fetch their own data; public playbook pages, admin, sitemap and robots render on the server.

### 5.3 An assistant turn

One entry point, `POST /api/trips/:id/ask` → `src/server/ai/handleAskRequest.ts` → kernel in
`src/server/assistant/` (ADR-033, ADR-043).

1. **Admission** (`admission.ts`): nine ordered stages, any of which can refuse: demo trip, identify actor, cap
   body (128 KiB), parse, resolve surface (trip | day | page), select model, admit quota, classify, grant tools.
2. **Model**: live or simulated, decided by `AI_LIVE` or the `ai-live` flag, **failing closed to simulated**. No
   `ai.ask` capability → 402.
3. **Quota**: Postgres counters per user and global, hourly and daily, plus a step reservation settled afterwards
   (`src/server/quota.ts`).
4. **Intent classifier**: one cheap call sets `TaskClass` (`question | edit | plan | compose`) → `ModelTier`
   (`cheap | mid | strong`), capped by the plan.
5. **Grant**: tools offered = `min(surface, role, plan, classifier)`. Each tool declares a `domain` and an `effect`
   (`read | steer | spend | propose | write`). A viewer's assistant holds pure reads.
6. **Loop**: up to `MAX_ASK_STEPS = 8`, 150 s per step, 240 s hard. Planning tools are derived from
   `BatchableCommand` (ADR-015), so the assistant's vocabulary is the command vocabulary.
7. **Proposals, never writes.** Write tools fill a per-turn buffer that leaves on the stream's final chunk.
   **A proposal of more than one command and no insert is stored instead** (ADR-067): `suggestOnFinish`, one
   stage downstream of `messageMetadata` (which is synchronous), calls `server/ai/suggestProposal.ts`, which saves
   a snapshot named `Before: <request>` and stores ONE suggestion `via: assistant` authored by the asker — both
   through the functions an editor's own buttons use. The final chunk then carries `suggested { suggestionId,
   changeCount, snapshotId, snapshotName, snapshotSkipped? }` in place of `proposal`; the board re-reads its
   suggestion list on it, and the ghosts, the chip and *Accept all* are the review. A refused store (a cap,
   more than 50 changes) deletes the snapshot and returns the card with `notSuggested`, so nothing is stored
   and nothing is lost. Nothing is appended to the trip's stream either way.
8. **Apply**: the human approves → `POST …/ask/apply` → `executeTripCommandBatch` as that user. No model call.
   Still the path for one-command and insert turns.
9. **Ledger**: one `TurnCost` per turn on every end path (done, error, abort) via `after()`, into the three
   `ai_usage*` tables, plus an `ai.ask` console record and Sentry metrics.

The assistant does **not** run on eve. ADR-062 is Proposed; only its measurement half is built.

### 5.4 Checkout → webhook → entitlements

1. `POST /api/billing/checkout`: the server picks the live plan version, refuses if any live subscription exists,
   ensures a Stripe customer and creates a hosted Checkout Session. The client never names a version or price.
2. The browser's return from Stripe grants nothing.
3. `POST /api/stripe/webhook`: verify the signature over the raw body, then `applyStripeEvent`.
4. **Claim the event id** in `billing_events` (`ON CONFLICT DO NOTHING`; a redelivery stops here). Re-fetch the
   subscription from Stripe instead of trusting the event body. Drop events older than `last_event_at`. Write
   `subscriptions`, then `users.plan_id/plan_version`.
5. **Entitlements are resolved per request** (`entitlements/resolver.ts`): the union of the held plan version and
   active grants. Plans are a committed append-only array, `PLAN_VERSIONS`, not a table (ADR-045). Capabilities:
   `ai.ask`, `ai.command`, `trip.collaborators`, `api.tokens`.
6. **A lapse is derived, not written.** `past_due` still confers for `GRACE_WINDOW_DAYS = 3`, computed at read time;
   only a definitive end writes `free`. This is what removes the need for a scheduler (ADR-047).
7. Grants: one 7-day trial per account ever, referral rewards, admin comps, founder.

### 5.5 A public `/api/v1` call

Every handler is produced by `route({ METHOD: { scope, trip, role, query, body, response, idempotent, handle } })`
(`src/server/public-api/route.ts`). Gates, in order:

1. **Credential**: bearer token (sha256 lookup; expiry, revocation and the owner's `api.tokens` checked on read),
   else the session cookie. A malformed `Authorization` header never falls back to the cookie.
2. **Rate limit** (tokens only): 1000/hour per token, Postgres counters; store down → 503, fail closed.
3. **Scope**: nine scopes, a set, not a rank. A session holds all.
4. **Shape**: query and body parsed by declared Zod schemas.
5. **Trip confinement, then membership**: always those two gates in that order.
6. **Idempotency** (opt-in per POST, ADR-051): key reserved per user before the handler runs; replay returns the
   stored response; 24 h TTL.
7. **Handler**: the same server functions the app uses.
8. **Response**: validated against its schema; errors are always `{ error: { code, message, details? } }` from a
   closed enum. Pagination is keyed cursors, default 50, max 200.

A new feature owes the API an *exposure line*, not an endpoint (`docs/guidelines/using-the-api.md`).

### 5.6 Invites, shares, sign-up

- **Invite**: a 32-byte token stored as issued. `/invite/<token>` is public; the proxy banks the token in a
  short-lived cookie across the OAuth round trip. Accept flips status and inserts the membership in one
  transaction, conditioned on the row still being pending. Inviting needs the owner's `trip.collaborators`.
  Before accepting, the landing and "Have a look first" both draw `InvitePlanCard` from the token-scoped
  preview (`TripPreview`), never the board.
- **Pinned share**: a `trip_shares` row holding the trip's `seq` at creation. Reading it replays the first `seq`
  events (ADR-027). Re-pinning is a new row.
- **Sign-up is open** (ADR-063, signup). Invite codes now only track referrals.

### 5.7 Content bundles

JSON under `content/`, format `travel-collab/content-bundle/v1`, imported by `apps/web/scripts/import-content.ts`
(ADR-041). Trips go through the real command endpoint, never a projection write. Production import is a manually
dispatched workflow. Details: `docs/guidelines/content-bundles.md`.

## 6. Auth and access

- **Session**: JWT cookie, no DB adapter. The token names its Vercel environment and is rejected elsewhere
  (ADR-034). A `users` row is upserted at sign-in (ADR-025).
- **Two Auth.js instances**: edge-safe `authConfig` for `proxy.ts`; the full one in `server/auth.ts` (ADR-024).
- **The proxy is not the security boundary.** It only tidies signed-out navigation. Every API route authenticates
  itself.
- **Roles**: `viewer < suggester < editor < owner`, one rank table in `src/server/accessPolicy.ts`, with an
  exhaustive minimum role per command. Planning and history commands need `editor`; delete/restore need `owner`.
- **The owner is not a membership row.** It comes from `TripCreated.createdBy` in the log.
- **Read seams**: `requireTripAccess` (session routes) and `tripAccessFor` (public API). Forbidden is decided
  before parse, so a stranger learns nothing.
- **Suggestions** (`src/server/suggestions/`, ADR-064): drafts are stored commands in two CRUD tables, never
  events, replayed by an editor or owner on accept with `origin: suggestion`, or `suggestions` for *Accept all*,
  which is one batch and one History entry (M40 D1). Since ADR-067 a suggester, an editor and the owner may all
  create one; a viewer may not. Caps: 50 open changes per author (an assistant suggestion, `via: assistant`, is
  exempt and not counted), 200 per trip, 50 per suggestion. `via` rides on the change and on the accept's
  `Origin`, so the chip and History read *"Suggested by Ana, via the assistant"*.
- **Named snapshots** (`src/server/snapshots/`, M40 D4–D5): a CRUD row labelling a `seq` — not an event, and
  not the event-store snapshot §4 says does not exist. Editors and the owner save, rename and delete them, 20 per
  trip; restoring is `RevertToState { toSeq }` through the ordinary pipeline, one undoable batch. The assistant
  saves one before storing a multi-change suggestion, or says it skipped it at the cap.
- **Tokens**: invite and share tokens are plaintext by recorded decision, so the owner can re-show the link
  (ADR-026). API tokens are hashed with a pepper, shown once, and must expire.
- **Anonymous readers**: the demo trip, pinned shares, and the public playbook library (ADR-061), each opt-in
  per route. A pending invite's holder reads only its landing and `GET /api/invites/:token/preview`, which
  carries no per-stop or per-person cost (M38 D4). "Have a look first" renders that preview, and a pending
  token opens no trip read (ADR-026 amendment, 2026-10-08).
- **Admin**: `users.is_admin`, checked in the route or server page, behind the `admin-console` flag.

## 7. External services

| Service | Used for | Seam | When it fails |
|---|---|---|---|
| Neon Postgres | everything durable, rate-limit counters, external-data cache | `db/client.ts` | errors propagate |
| Vercel AI Gateway | model calls | `aiModel()`, reachable only from `modelSelection.ts` | falls closed to `simulatedModel.ts` |
| Stripe | subscriptions | `billing/stripeApi.ts`, own HMAC verify in `signature.ts` | webhook 500 → Stripe retries |
| LocationIQ | geocoding, place search | `Geocoder` interface; only normalised results stored (ADR-007) | throws without a key; paced and quota'd |
| MET Norway, NASA POWER | forecast and climate widgets | ports + read-through `external_data_cache`; coordinates rounded first (ADR-052) | 4 s timeout; forecast degrades to "typical" |
| Upstash Redis | link-preview card data only | `CachePort`, drivers `upstash | memory | off` | swallowed; never a source of truth (ADR-059) |
| Next data cache | public library and OG cards, 24 h, tag-purged | `src/server/libraryCache.ts` | strangers may see a day-old page (ADR-063, cache) |
| Resend | welcome and invite email | `sendEmail` never throws | mail failure never undoes the action |
| Sentry | errors, traces, AI spans, metrics | shared options and scrubbing; tunnel `/monitoring` (ADR-032) | — |

**Rate limiting is in Postgres, not Redis**, because correctness may not rest on an expendable store.

## 8. Notebook and widgets

- A page write is a command (`CreatePage | EditPage | DeletePage`) through `executePageCommand`, on the trip's
  stream, so page history and restore come from the log (ADR-036). Because the stream is shared, notebook saves
  and trip edits serialise against each other.
- Stale-save guard: `EditPage.expectedUpdatedAt`. Body cap 512 KiB.
- The stored document is a **versioned AST** (`packages/contracts/src/pageDoc.ts`), migrated on read; a build must
  not save a document it cannot represent, and unknown nodes are preserved (ADR-038). TipTap is the editor, not
  the format.
- A widget is a **module** in `packages/pages/src/macros/primitives/`, not a database row (ADR-037); a **pure
  function of declared inputs** (ADR-035); and chosen as a **selection**, with named widgets being presets that
  are never stored in a document (ADR-039).
- `checkPageDocForWrite` validates every widget node on every page write.
- External data reaches a widget only as a server-fetched input, never from the browser (ADR-052).
- Each trip gets several seeded notebooks identified by `seed_key` (ADR-056).

## 9. Delivery rules that bite

- **Production migrations are a manual dispatch** of `migrate-production.yml` from `main`. Merging applies
  nothing. Preview builds migrate automatically, and only against a database flagged disposable.
- **Previews never share production's database** (they did until 2026-09-06).
- **CI is skipped for drafts**, and a prose-only branch runs only `ci-ok`. The budget is 2,000 Actions minutes a
  month.
- **An e2e result counts only from `pnpm --filter web test:e2e:ci-like`.**

## 10. Non-functional stance

| Concern | Position |
|---|---|
| Consistency | Per trip, a planning write is one transaction: append, both projections, optionally one extra row. Other clients converge in about one 2 s poll plus a refetch. |
| Concurrency | Optimistic, on the unique index. Unconditioned batches retry 3×; conditioned writes get a 409. CRUD modules lean on conditional updates, `ON CONFLICT DO NOTHING` and partial unique indexes. |
| Conflicts | Domain conflicts are data and dismissible. Write-write collisions on the same stop become a client-side `concurrent-edit` conflict. |
| Caching | Client: short-window `queryCache`. Server: Next data cache (library, OG), Redis (card data), Postgres (weather). Signed-out `/` is `private, no-store`. |
| Fail closed | rate limiter (503), AI (simulated model), malformed stored trip (throws, never reads as 404). |
| Fail open | Redis, email. |
| Cost ceilings | AI: per-user and global quotas, 8 steps, tier cap per plan, a gateway spend budget, the `ai-live` kill switch. Geocoding and the public API have their own quotas (`src/server/quota.ts`). |
| Security | CSP and frame denial in `next.config.ts`; hashed API tokens with mandatory expiry; environment-bound sessions; no question text or trip content in the AI ledger; dev routes 404 unless dev login is on. |
| Observability | Sentry; structured `ai.ask`, `ai.grant`, `ai.proposal.apply` records; the durable AI ledger; an admin console for plans and spend. |

**What bends first as it grows.** These are the places the current design is knowingly cheap:

1. **Fold-the-whole-stream on every write, no snapshots.** Cost grows with a trip's lifetime event count, and
   notebook edits share the stream. First thing to revisit for long-lived trips.
2. **Polling realtime.** One request per visible multi-member tab every 2 s. Fine for 2–4 people per trip; it is
   the request-volume line item if usage grows.
3. **No upcaster, no operator rebuild.** The first breaking event-schema change has to build both.
4. **Idempotency keys, billing events and revoked rows are never swept.** PK-only growth, accepted for now.
5. **Per-request entitlement resolution** and **client-fetched pages** each add a round trip that a cache or
   server rendering would remove.
6. **Manual production migration.** A merged migration can sit unapplied.

## 11. Decisions worth knowing, and where they are argued

| Decision | Rejected, because | ADR |
|---|---|---|
| Event-sourced modular monolith | git-style merges (hostile UX); full CRDT (history and revert get harder); microservices (one developer) | 001 |
| Only planning is evented; the rest is CRUD | whole-app event sourcing (ceremony); history as a peer of CRUD (dual write breaks revert) | 003 |
| Undo is compensating events | a movable head pointer (every reader must consult it forever) | 005 |
| Client predicts with the server's decider | client-ordered writes (turns the log into insert-anywhere) | 013 |
| Notebook edits are events on the trip stream | a `page_versions` table (dual write); a stream per page (reversed once realtime shipped) | 036, vs 014 |
| Widgets are modules and pure functions | HTML strings plus sanitising (one bypass from stored XSS) | 035, 037, 039 |
| Clone copies state, not events | copying raw events (carries every mistake and the undo history) | 017, 028 |
| Membership is CRUD; the link is the credential | `MemberAdded` planning events (invite logic inside Planning) | 026 |
| Share links pin a seq and replay | a snapshot in the share row (drifts, needs migrating) | 027 |
| Assistant proposes; a human applies | direct writes | 042, 043 |
| One AI route; the server picks the tools | client-supplied context choosing tools | 033 |
| Entitlements resolved per request from a committed file | a claim in the JWT (a downgrade would not bite until refresh) | 045 |
| Webhook is billing's only writer; a lapse is derived | writing `free` at lapse (needs a scheduler) | 047 |
| Realtime is a polled per-stream cursor | WebSockets, `LISTEN/NOTIFY`, SSE (nothing to hold a connection in serverless) | 049 |
| Redis only as an expendable cache | a Redis rate limiter (correctness on an expendable store) | 059 |
| Travellers are access data, counted at read | storing it in the log (Planning would know who is invited) | 065 |
| A stop's price is per person | — accepted as wrong for a shared room or taxi | 060 |
| Money is integer minor units, one currency per trip | floats (break bit-identical rebuild); live FX (a projection cannot call an API) | 008 |

**ADR status that is easy to misread**

- **Superseded or reversed**: 023 by 024. 014 ("pages are CRUD") is reversed in substance by 036 but carries no
  amendment. 036's own "page as its own stream" was reversed on 2026-09-24. 060 decision 2 is amended by 065.
- **Still marked Proposed, but built**: 025–029, 057, 058.
- **Proposed and only half built**: 062 (ledger and evals yes, eve port no).
- **Draft, nothing built**: 040.
- **Two files are ADR-063**: signup-is-open and the-public-library-is-cached-for-a-day. Grandfathered in
  `scripts/check-adr-numbers.mjs`. A bare "ADR-063" is ambiguous; say which.

## 12. Where prose and code disagree

| Prose says | Code does |
|---|---|
| `AGENTS.md`: "Current phase: 1 (full single-player product)"; AccessPolicy is "actor is the owner" | Multi-user with four roles, billing and a public API are shipped |
| `AGENTS.md` module map | No row for Notebook or Assistant |
| "UI must not import `packages/domain`" | True to the letter; `@tc/predict` re-exports the decider, so domain code runs in the browser by design |
| `stack-and-constraints.md`: no edge runtime | `src/proxy.ts` is written edge-safe and its comments say Edge. Holds for every data path |
| ADR-049: 5 s poll; a `broadcast.ts` comment still says "five seconds apart" | `POLL_INTERVAL_MS = 2000` |
| ADR-062's title: the assistant runs on eve | It runs on the AI SDK through the gateway |
| Foundation spec §5: events table without `batch_id`/`origin`; snapshots "deferred" | Both columns exist; still no snapshots |
| "Handlers never fold at read time" | True for trip reads; every write folds the full stream, and shares and history replay on read |
| "The webhook is billing's only writer" | One stated exception: checkout writes `users.stripe_customer_id` |
| Widget registry comment: "Twelve primitives" | About 25 registered definitions |
| `admission.ts` is named as a gate | Since open signup it only tracks referral codes |

## 13. Not verified

- Which runtime `proxy.ts` actually executes in under Next 16. The file's comments say Edge; nobody checked the
  build output.
- Neon and Vercel project settings and env values.
- Which string ends up in `users.id` for Google accounts (`google-<sub>` or the bare `sub`); the schema comment
  and `authConfig.ts` were not reconciled.
- How `import-content-production` writes to production.
- The exact `BatchableCommand` membership and the full conflict rule list (read indirectly).
- ADR line-level details behind §11 (condensed from the ADRs, not re-read line by line).
