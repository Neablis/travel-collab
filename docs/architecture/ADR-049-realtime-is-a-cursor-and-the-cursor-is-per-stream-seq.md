# ADR-049 — Realtime is a cursor the client asks for, and the cursor is per-stream `seq`

**Status:** **Accepted — 2026-09-22.** M13 link 1, which gates links 2–5.
**Accepted on Mitchell's instruction to begin implementation** — the same
conversation that asked for the draft, not a separate written review. The basis
is recorded rather than blurred, the same way M21's, M22's and M26's attested
gate boxes are.
**Open to reversal on Decision 2 (the transport) specifically**: the request
that placed M13 said *"websockets"* and this ADR rejects it, so that is the
decision most likely to be revisited — and Decision 3's seam is precisely what
makes revisiting it one module rather than a rewrite. Decision 1 (the cursor) is
the one that would be expensive to change.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-001** (event-sourced modular monolith — the log this reads),
**ADR-027** (a share link is pinned to a `seq` and the read replays — the same
coordinate this ADR adopts, already load-bearing in production), **ADR-012**
(`TripProvider` is a server-cache + dispatch, never a store), **ADR-013**
(optimistic updates and atomic batches — the queue a remote event arrives into),
**ADR-046** (the client read cache is an SWR-shaped seam — and the ADR that
wrote down *"with no realtime, refetch-on-mount is the only mechanism by which
anyone ever sees a co-traveller's edit"*), **ADR-033** (one AI route — the
precedent that SSE works in this deployment), **ADR-002** (the stack this adds
no dependency to)

## Context

Two people can already be on a trip. M11 shipped memberships, roles, invites and
revocation, so the access half is done. What is missing is that **the second
person's edits do not arrive**: a trip is fetched, folded and rendered, and
nothing pushes. ADR-046 said the consequence out loud — refetch-on-mount is the
only way anyone sees a co-traveller's edit, which is why that ADR refused to buy
request count with a long TTL.

The roadmap has carried *"realtime transport ADR"* since 2026-07-28, and the
request that placed M13 used the word *"websockets"*. **That is not a decided
transport**, and this ADR is the place it gets decided against this project's
actual constraints rather than in the abstract. Four of those constraints are
facts about the tree, not preferences.

### 1. The log is per-trip, and its position coordinate already exists

`appendToStream` writes `seq: args.expectedSeq + 1 + i`
(`apps/web/src/server/eventStore.ts:58`) under a unique index on
`(stream_id, seq)` (`apps/web/drizzle/0000_workable_manta.sql:19`,
`schema.ts:275`). Both command paths pass `expectedSeq: history.length`
(`commands.ts:109`, `commands.ts:235`) — the count of events already in the
stream.

So **a stream's seqs are `1..N`, contiguous, no gaps.** `getTripDetailAtWithHead`
relies on exactly that when it returns `headSeq: envelopes.length`
(`history.ts:68`). ADR-027 already pins every share link to this coordinate and
replays the log to it. The coordinate a subscriber needs is not a new idea in
this codebase; it is the one already in production.

It is also already in the contract: `HistoryEntry` carries `fromSeq` and `toSeq`
(`packages/contracts/src/history.ts:64-65`), so the client holds the head seq
today — as `entries[0].toSeq`, derived rather than declared.

### 2. `global_seq` is a `bigserial`, and it is in no contract

`global_seq` is `bigserial PRIMARY KEY` (`schema.ts:256`,
`0000_workable_manta.sql:2`). `EventEnvelope` — what `toEnvelope` builds and
every reader downstream sees — carries `streamId`, `seq`, `type`, `version`,
`payload`, `actorId`, `occurredAt`, `batchId` and `origin`
(`eventStore.ts:17-29`). **`globalSeq` is not among them.** Its only reader in
the tree is `readAll`, which orders by it for total-order replay
(`eventStore.ts:93`).

### 3. SSE already works in this deployment

The ask route serves `text/event-stream` and an integration test asserts it
(`apps/web/src/app/api/trips/[tripId]/ask/route.int.test.ts:1987`). Whether this
platform can stream to a browser is not an open question — ADR-033 answered it.

### 4. There is no shared server process to broadcast *from*

The app runs as serverless functions with a `pg` `Pool` per instance
(`apps/web/src/server/db/client.ts:6`). The function that appends an event and a
function holding a subscriber's connection are **different invocations, possibly
on different instances, with no shared memory and no shared event bus.** This is
the constraint that decides the transport, and it is the one the word
*"websockets"* skips over.

## Decision

### 1. The cursor is per-stream `seq`. `global_seq` is rejected as the cursor.

The wire question a subscriber asks is *"what has happened on this trip since
`seq` N?"*, answered as an index range scan on `events_stream_seq` — an index
that already exists, so this adds none:

```sql
SELECT … FROM events WHERE stream_id = $1 AND seq > $2 ORDER BY seq
```

**Why `global_seq` cannot be the cursor — and this is a correctness argument,
not a taste one.** A `bigserial` hands out its value at `INSERT` time, but a row
becomes visible at `COMMIT`, and those two orders are not the same. Transaction
A takes `global_seq` 100; transaction B takes 101; B commits first. A reader
polling `WHERE global_seq > cursor` sees 101, advances its cursor to 101, and
*then* A commits. **Event 100 is never returned to that reader again.** The
window is small and the loss is silent and permanent — the same shape as the
three optimistic-queue entries M13 link 3 exists to close, which is not a class
this project should add a fourth member to.

Per-stream `seq` does not have that window, because of how the append protocol
works rather than by luck. Writing `seq` N+1 requires `expectedSeq: N`, which
requires having read N committed rows in that stream; two writers that both read
N collide on the unique index and one comes back `concurrency-conflict`
(`eventStore.ts:71`). So **the commit of `seq` N+1 cannot become visible before
the commit of `seq` N.** Per-stream `seq` is monotonic in *commit* order, not
merely in assignment order, which is precisely the property a cursor needs.

Three smaller reasons pointing the same way:

- **Gaps are detectable.** Because seqs are `1..N` contiguous, a subscriber that
  receives a skip knows something is wrong and can resynchronise by refetching.
  With `bigserial`, gaps are *normal* — every rolled-back transaction leaves
  one — so a real loss is indistinguishable from routine sequence burn. A
  cursor you cannot audit is a cursor you cannot trust.
- **It is already in the contract.** `HistoryEntry.fromSeq`/`toSeq` ship today.
  A `global_seq` cursor means widening `EventEnvelope` with a field no reader
  wants, on the contract every projection and replay path folds.
- **A subscriber only ever wants one stream.** `global_seq` is a cross-tenant
  coordinate for a per-tenant subscription: it would have to be filtered
  server-side anyway, and handing a client a monotonic count of *everything the
  installation has ever written* leaks the pacing of other people's trips for
  nothing.

`global_seq` keeps the job it has — total-order replay in `readAll` — and does
not acquire a second one.

**This answers M13's first gate box directly: `events.global_seq` does not serve
as the cursor, and the reason is commit-order visibility.**

### 2. The transport is polling with a cursor. SSE is rejected *for now*, and the reason is constraint 4.

`GET /api/trips/:tripId/events?after=<seq>` → `{ headSeq, events: [...] }`,
envelopes in `seq` order, an empty array when nothing has moved.

The case against SSE here is not that it does not work — constraint 3 says it
does. It is that **on this runtime, SSE without a broker is not push; it is
server-side polling that you additionally pay to hold open.** A handler holding
an `EventSource` connection has no way to *learn* that an event was committed by
some other invocation (constraint 4), so it must query the database on an
interval itself. Compared with the client asking on the same interval, that buys
a lower delivery latency on the last hop and costs a held function invocation
per viewer per connection — and Vercel's function duration cap means the
connection dies and reconnects regardless, so the hold is not even durable.

Polling also makes M13's third gate box — *a viewer who loses access mid-session
stops receiving updates* — nearly free and structurally correct: **the next poll
re-checks `AccessPolicy` because it is a fresh request.** A held connection has
to be actively torn down when a revocation lands somewhere else, which is a
whole second mechanism to build and a second thing to get wrong.

Two details, so this is a decision and not a direction:

- **Interval.** 5s while the document is visible; **stopped entirely when the
  tab is hidden**, with one immediate poll on `visibilitychange` back to
  visible. ADR-046 noted that nothing in this app listens for `visibilitychange`
  or `focus` yet; this is the first thing that should.
- **Poll only when there is someone to poll for.** The interval runs when the
  trip has more than one member; a solo trip has no second writer, so the
  interval is pure cost. The **visibility-regain poll runs regardless**, because
  one person in two tabs is a real case and that single read covers it. This is
  the one tunable in the decision, and it is the one to revisit with real usage.

### 3. The transport sits behind a seam, because the cursor is the durable decision and the transport is the swappable one

Broadcast enters `TripProvider` through one module with one shape — *"here are
envelopes after `seq` N, and here is the head"* — and nothing above it knows
whether a poll or a stream produced them.

This is what makes rejecting SSE cheap to revisit rather than a bet: SSE's own
reconnect protocol sends `Last-Event-ID`, which **is** this cursor, and its
frames carry the same envelopes. Adopting SSE later — once there is a broker,
`LISTEN`/`NOTIFY` on a connection something can actually hold, or usage that
justifies the held invocation — changes that one module and no contract. Getting
the *cursor* wrong, by contrast, would be a change to `EventEnvelope` and every
folder and replay path that reads it.

### 4. Received events go through link 3's reducer, not around it

A remote envelope arriving while the local send queue is non-empty is the same
problem as a local outcome arriving while the queue is non-empty: adopt an
authoritative outcome, then re-predict what is queued against it. That is
exactly the widening of `confirmHead` that KI-90 already names as the fix for
KI-90, KI-5's precondition and KI-77 at once, and that M13 link 3 owns.

**So broadcast must not have its own merge path.** If a received event took a
shortcut into `confirmed`, it would discard the pending queue the same way the
unconditional `pending: []` does today, and M13 would ship a fourth member of
the loss class it was scheduled to close. This is also why link 1 and link 3
belong in one milestone and why doing realtime first would build the same
machinery twice.

### 5. The broadcast read is an `AccessPolicy` decision, and the same one as reading the trip

The endpoint asks `hasAtLeast(actorId, members, "viewer")`
(`accessPolicy.ts:31`) — the same object and the same rank table that decide who
may read the trip, per AGENTS.md invariant 6c. Receiving an event is reading, not
a new capability, so it does not get a new policy question.

## What this rejects, and why

The gate box asks for this explicitly.

| Rejected | Why |
|---|---|
| **WebSockets** | A long-lived socket needs a process to terminate it. On serverless there is none (constraint 4), so this means a managed service — a vendor, a bill, a second auth boundary and a second place trips have members. Nothing in M13's scope needs bidirectional frames: the command pipeline already has an HTTP path and link 2 is explicitly read-side push. |
| **A hosted realtime broker** (Pusher/Ably/PartyKit) | Same objection, plus ADR-002's stack gains a dependency for a product that has ~2–4 people on a trip. Revisit if the seam in Decision 3 ever has usage behind it that a poll cannot serve. |
| **Postgres `LISTEN`/`NOTIFY`** | Technically on the wire — this is `pg`, not the HTTP driver (constraint 4) — but a listener has to be *held*, and a serverless invocation cannot hold one past its own lifetime. It would also need a connection per listening instance, against a pool budget sized for short queries. It becomes the right answer the moment there is a long-lived process, and not before. |
| **SSE, now** | Decision 2: without a broker it is DB polling plus a held invocation, and the held invocation is what we would be paying for. The seam keeps this a one-module change later. |
| **`global_seq` as the cursor** | Decision 1: commit-order visibility can silently skip an event, gaps are undetectable, it is in no contract, and it is cross-tenant. |
| **Broadcasting projections instead of events** | Sending a recomputed `TripDetail` to every viewer would make the payload the whole trip on every keystroke-sized edit and would give the client nothing to reconcile a queue against. The log is the thing that has an order; the projection is a fold of it. |

## Consequences

- **Freshness is bounded by the interval, and is a number we chose.** A
  co-traveller's edit appears within ~5s of being committed, not instantly. That
  is a product-visible latency and it is the explicit price of not running a
  broker. It is also a straight improvement on today, where the answer is
  "whenever someone remounts".
- **One new endpoint, no new index, no migration.** The range scan uses
  `events_stream_seq`. Link 5's per-stop attribution still needs its own
  migration; this link does not.
- **`EventEnvelope` does not change**, so no contract change and no
  `docs/contracts/CHANGELOG.md` entry for link 1. Declaring `headSeq` on
  `TripHistory` rather than leaving it derived as `entries[0].toSeq` is a
  contract change worth making, but it belongs to link 2 where a reader needs
  it.
- **Poll cost is bounded and predictable**: one indexed range scan per visible
  multi-member trip per 5s, zero for a hidden tab, zero for a solo trip.
- **The `visibilitychange` listener ADR-046 observed was missing gets built**,
  and it is a general seam that the read cache can use later.
- **If this decision is wrong, the thing that was wrong is the transport, and it
  is one module.** The cursor — the part that would be expensive to change — is
  the coordinate ADR-027 already committed this project to.

## What this ADR does not decide

- **The conflict representation** (link 4). Two people editing the same stop is
  a conflict the domain can already express and M1's soft-conflict engine is the
  shape to reuse; how a concurrent edit is *modelled* is link 4's decision, not
  the transport's.
- **The attribution field** (link 5). `who` is a schema and contract decision
  with its own migration, and M19 link 3 and M14's two cut person widgets both
  depend on it.
- **Presence** ("Mitchell is viewing this trip"). Not in M13's scope, not in
  this ADR, and it is the one thing on this list that a poll genuinely serves
  worse than a stream — worth naming so a later presence feature re-opens
  Decision 2 rather than assuming it.
