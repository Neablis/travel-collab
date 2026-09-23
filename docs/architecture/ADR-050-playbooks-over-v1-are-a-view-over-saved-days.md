# ADR-050: Playbooks over v1 are a view over saved days

**Status:** **Accepted — 2026-09-23.** Mitchell approved building Phase 1 ahead
of M12, in the conversation that asked for it.
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-048** (a Playbook is a sequence of days — the row this serves),
**ADR-029** (the Library; one insert is one batch and one undo), M22's public
API design (`docs/specs/2026-09-16-public-rest-api-and-scoped-tokens-design.md`)

## Context

M23 made a Playbook an ordered set of days stored as one `saved_days` row
(ADR-048), and the app can keep several days and apply them to a trip. The public
API could do neither. `POST /v1/library` takes a singular `dayId` on purpose — it
was published before M23 and M23's scope said nothing about `v1` — so an
integrator could keep one day at a time and could not apply anything at all.

Everything needed already existed server-side: `saveDay` takes `dayIds`, and
`insertSavedDay` is the one construction of "append this sequence to a trip" —
one `executeTripCommandBatch`, fresh ids, the adds ledger in the same
transaction, `readableSavedDay` deciding whose Playbooks you may take.

## Decision

1. **`/v1/playbooks` is a second `v1` view over `saved_days` rows**, not a new
   resource. `GET`/`POST` on the collection and `GET`/`PATCH`/`DELETE` on one
   Playbook, with the library's scopes (`library:read`, `library:write`). The
   `POST` body is the contract's own `CreateSavedDayInput`. Both trees declare
   through one module (`server/public-api/library.ts`), so they cannot drift.
2. **`/v1/library` is frozen as it is.** Same body, same answers, same
   `openapi.json` entries — the regeneration that added `/v1/playbooks` changed
   no line of them.
3. **Applying is `insertSavedDay` over `v1`**:
   `POST /v1/trips/{tripId}/playbook-applications`, `trips:write`, `editor` on
   the destination. Atomic, append-only, one history entry, one undo, fresh ids.
   Somebody else's private Playbook is a 404, as it is in the app.
4. **It answers id lists in Playbook order, not maps.** `dayIds[i]` is the
   Playbook's day `i`; `activityIds[i]` is its `stops[i]`. A `SavedStop` has no
   stable key of its own, so a `{ sourceKey: newId }` map would have to invent
   one — position is the key the DTO already has. The lists are read from the
   batch `insertCommands` built, so they are the ids that landed, not a second
   minting. `historySeq` is that one entry's `toSeq`.

## Rejected

- **A `playbooks` table.** ADR-048 refused a second publishable object type, and
  M12's moderation, reviews and reports all key on `saved_days`. A second table
  is a second place for all of it.
- **Widening `/v1/library` to `dayIds`.** Breaks every existing caller, or leaves
  two shapes for one question — the thing `CreateSavedDayInput` refused for
  itself.

## Deferred (Phase 2)

Applying part of a Playbook (some of its days), composing one inline in the
request, editing a Playbook's content or versioning it, `Idempotency-Key` on the
apply, and an `expectedTripSeq` precondition. Until the last two exist, a
retried apply appends twice, and a 409 is the only concurrency signal.

## Consequences

- **A confined token cannot keep a Playbook**, even from a trip it names. Neither
  collection declares `trip`, so `route()` refuses a trip-confined token before
  the handler's hand-written trip gate runs — as it already did on
  `POST /v1/library`. The hand gate's confinement check is reachable only by a
  session today.
- `insertSavedDay` returns `minted` on success. The internal
  `POST /api/trips/:id/saved-days/:savedDayId` picks its own fields and is
  unchanged.
