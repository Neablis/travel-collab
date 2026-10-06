# ADR-066: A queued unit carries a key, and the server applies it once

**Status:** **Proposed — 2026-10-06.** Implemented on `claude/great-dirac-p741cf` to close
KI-5's residual races 1 and 2. It needs Mitchell's review before merge, because it adds a table
and changes both command routes.
**Deciders:** Mitchell (product); Claude — drafted
Related: **KI-5** (optimistic commands lost on abrupt navigation), **KI-36** (a failed send is
retained and retried by hand), **ADR-050** (`expectedSeq`, the caller's precondition), **ADR-005**
(one append is one history entry), **KI-2026-09-25-i** (the browser that hid the first of these).

## Context

The board's send queue (M6) persists one unit at a time. When the page goes, `TripProvider`
flushes what is left as one keepalive batch on `pagehide` (KI-5, 2026-09-25). That flush could
not safely carry the unit already on the wire. The server had no way to tell a unit it had
already applied from a new one, and re-deciding an applied `MoveActivity` after a later move is
not a no-op. So the flush left that unit out and raced it, which left two losses:

1. **The flush overlaps the unit in flight.** Whichever loses the `events_stream_seq` race is
   refused. The batch side was patched with a re-run. When the unit in flight lost, its 409 went
   to a page that was gone, and the flushed units persisted without it.
2. **The flush overtakes the unit in flight.** The unit never reached the server, or read the
   stream after the flush committed. The flushed units were then decided without it, which is not
   a prefix of what the user did.

Telling these apart needed the client to guess whether a request it never got an answer to had
landed. Chromium 151 changed which guess was right. That is how `m6-unload-flush.spec.ts` went
red in CI and stayed green locally (KI-2026-09-25-i).

## Decision

1. **A unit's id is its key.** `TripProvider` mints `crypto.randomUUID()` for every queued
   unit, where it used to mint `c1`, `c2`, … per provider. The sender sends the unit under that
   key every time: its first send, a KI-36 retry, and the unload flush.
2. **The key travels where each route can read it without changing its body.** The
   single-command route reads an `Idempotency-Key` header. The batch route takes
   `{ units: [{ key, commands }] }` as well as plain `{ commands }`. `TripCommandUnit` and
   `CommandUnitKey` are the contract (`packages/contracts/src/trip.ts`). A request without a key
   behaves exactly as before.
3. **The server records a receipt, and the primary key is the guarantee.** The new
   `command_receipts(trip_id, key, created_at)` table is written in the same transaction as the
   unit's events, with primary key `(trip_id, key)`. A unit already on the trip's receipts is
   never decided again. If two requests carrying the same unit race, the second insert loses at
   the primary key and its transaction rolls back. Receipts are read **before** the stream, so a
   receipt that is seen comes with the events it committed with. Read after, a flush committing
   between the two reads would be answered "applied" with a trip that did not yet hold it. A keyed
   `no-op` gets a receipt too: it is a decision, and a resend must not be decided again against
   a trip that has moved since.
4. **An applied unit is answered with the trip as it stands.** The answer is success, not
   `no-op`, because the unit did have its effect, once. The sender confirms it like any other
   applied unit. A keyed batch leaves out the units already applied and decides the rest in
   order. If none are left, it answers with the trip and appends nothing. **A keyed batch decides
   unit by unit:** a unit the domain refuses is left out, and the units after it are still
   decided, as the in-app drain already does (KI-5 residual 8). A unit stays atomic within itself.
   With every unit refused, the answer is the first refusal. Without this, the flush carrying a
   unit in flight that the server was refusing would be refused whole, and everything behind it
   lost.
5. **The flush carries the whole queue, the unit in flight included.** On `pagehide`, every
   queued unit goes with its key. If the unit in flight already landed, the server leaves it
   out. If it never arrived, the server applies it first, in its place. Either way, what persists
   is a prefix of what the user did. The flush takes over (`handedOff`) only the units the sender
   had not sent. A sent unit stays the sender's to confirm if the page survives. A sent head that
   would cost units behind it their place in the 48 KiB keepalive budget is dropped from the
   flush instead (`unloadFlushAfterHead`): it may well have landed, and they have not. A send
   failure with no response (`status: 0`, marked `unanswered`) no longer holds the flush back,
   because it refused nothing and the flush resends the head under its key.
6. **Lost races.** A keyed batch whose receipt insert loses is a lost race like an append's. It
   is rolled back and run again, at most `BATCH_APPEND_ATTEMPTS` times, and the re-run leaves
   that unit out. A keyed single command that fails, by losing its append race or by a domain
   rejection the flush's events caused (an `AddDay` of a day that now exists), looks up its
   receipt once more in one indexed query. On a hit it reads the trip and answers success. On a
   miss the original failure stands. It is **never decided a second time**: a head re-decided
   after a flush could land after units the user made later.
7. **The code tolerates the table not existing yet.** Merging deploys before `migrate-production`
   runs migration 0041, and every board edit carries a key. Until the table exists, receipts are
   skipped, and a key does nothing (`receiptsTableExists`, which caches only a sighting). In that
   window a flushed unit in flight that had landed is decided again: an `AddDay` is refused and
   left out (decision 4), but a `MoveActivity` is applied twice. That was the pre-ADR risk this
   ADR closes, so dispatch the migration soon after merging.

## Consequences

- KI-5 residuals 1 and 2 close for every unit this provider sends. A KI-36 retry of a send whose
  answer was lost but which had landed is now answered, not refused as a duplicate.
- One receipt row per unit applied with a key, kept for the life of the trip, about as many rows
  as `events` gains anyway. Receipts are not a projection. Nothing is rebuilt from them, and
  losing the table loses only de-duplication.
- An undone unit keeps its receipt, so a late resend of it is answered and not re-applied. That
  is correct: it was applied, then undone.
- Other callers (the assistant's batches, the public API, playbooks, clone, demo reseed) send no
  key, and nothing about them changes.
- **Not closed here:** units beyond the keepalive budget (residual 4), a mobile tab killed
  without `pagehide` (5), and the in-app drain's own windows (6–8). A queue KI-36 has marked
  failed is still not flushed (3), by decision.

## Rejected

- **Hashing a unit's commands as its key.** Two identical edits made on purpose, such as adding
  a day twice, would collapse into one.
- **Putting the key on `events`.** One append can hold several units (a flush), and one unit
  produces several events, so a key column there would need a uniqueness rule events do not
  have.
- **Retrying the keyed single command in full.** See decision 6.
- **An `expectedSeq` on the flush.** Still the wrong precondition, for the reason KI-5's first
  decision gives. The key answers the question that precondition could not.
