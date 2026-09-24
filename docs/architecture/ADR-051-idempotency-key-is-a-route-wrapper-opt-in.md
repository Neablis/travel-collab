# ADR-051: `Idempotency-Key` is a route-wrapper opt-in, stored per user

**Status:** **Accepted — 2026-09-24.** Built with ADR-050's Pass B, on
Mitchell's approval to build the Playbooks API's deferred phases ahead of the
current milestone.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-050** (the first endpoint that uses it), M22's public API design
(`route()` is where every cross-cutting concern lives once), the billing
webhook's claim-then-complete (`billing/webhook.ts`, PR #177 — the same shape,
for Stripe's event ids)

## Context

`POST /v1/trips/{tripId}/playbook-applications` creates days and stops. A caller
whose connection drops after sending it cannot tell whether it landed, and a
retry appends the Playbook a second time. `expectedTripSeq` catches that only
if the caller sent it; most will not. The general answer is an idempotency key,
and nothing about one is specific to Playbooks.

## Decision

1. **A declaration opt-in on `route()`**: `idempotent: true` (or
   `{ onReplay }`) on a `POST`. `route()` throws at import on any other method.
   Enabled on the playbook-application endpoint, and since ADR-050's Pass C
   on `POST /v1/playbooks` and `POST /v1/playbooks/import`. The OpenAPI
   generator documents the `Idempotency-Key` request header and the
   `Idempotent-Replayed` response header for every operation that sets it.
2. **One table, `api_idempotency_keys`, keyed `(user_id, key)`** (migration
   `0027`). Per user, not per token: two of one person's tokens share a key
   space, two people's never collide.
3. **Reserve before running.** After every gate and the body parse, the key is
   inserted with `ON CONFLICT DO NOTHING`; only the winner runs the handler. A
   loser reads the row and decides (`decideKey`, pure):
   - older than **24 hours** → absent: taken over (an `UPDATE` matched on the
     `created_at` it read, so of two takers only one wins), then run;
   - different method, path or body hash → **400** `invalid-request`
     ("Idempotency-Key reused with a different request");
   - finished → **replay** the stored status and body with
     `Idempotent-Replayed: true`, without running the handler;
   - unfinished and under **5 minutes** old → **409** `conflict`;
   - unfinished and older → abandoned by a dead process: taken over and run.
4. **The body hash is sha256 over the parsed body's canonical JSON** (keys
   sorted at every depth), so key order on the wire does not matter.
5. **A 5xx is not kept.** The reservation is deleted and a retry runs. **A 4xx
   is kept** and replayed: the handler ran and answered, and the key promised
   the same answer again. Validation and gate refusals happen before the
   reservation, so they spend no key.
6. **No sweep.** Expiry is resolved on read; an old row is overwritten the next
   time its key is used, and otherwise just sits there.
7. **Completion is matched on the reservation's own `created_at`**, so a request
   that outran its lease cannot complete or release the reservation that took
   its key over. If completing throws, the caller still gets its answer and the
   key stays in flight until its lease ends.

## Rejected

- **Per-endpoint keys in each handler.** The second endpoint to want one would
  copy the first, and the copies would disagree about what a replay is.
- **Keying by token.** Rotating a token mid-retry would then run the request
  twice.
- **Storing 4xx as "not kept" too.** A 409 `version-mismatch` replayed as a
  fresh run could succeed once somebody else's edit lands, so the same key would
  have given two different answers.
- **A sweep job.** A cron for a table only ever read by primary key buys
  nothing but a moving part.

## Consequences

- Response headers a handler sets are not stored, so a replay carries only
  `Idempotent-Replayed`. No idempotent endpoint sets one today.
- The table grows by one row per keyed request, forever, until a key is reused.
  Rows are small; revisit if it is ever large.
- The 5-minute lease assumes no handler runs that long. A handler that did could
  be taken over and run twice.
