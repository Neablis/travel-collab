### KI-5 — queued optimistic edits can still be lost, unannounced, in five narrow windows when the page or the trip screen goes away

- **Severity:** correctness, narrow (the person isn't told about the loss). The general loss this
  entry was filed for is closed (see *What closed*). What is left are the five residual windows
  below (6 closed on 2026-10-25). The numbers are the ones source comments, ADR-066 and other entries cite.
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx` (the sender, `sentIds`, the
  `pagehide` flush and the unmount hand-off); `unloadFlush.ts` (`KEEPALIVE_BODY_BUDGET`,
  `unloadFlushAfterHead`); `queueDrain.ts` (`drainAfter`); `optimistic.ts`;
  `apps/web/src/server/commands.ts` (`executeTripCommandBatch`, keyed units, `command_receipts`).
- **Symptom / what is still open:** each of these is a loss nobody is told about, because the page
  that could say so is gone. Items 4 and 5 apply to `pagehide` only. Items 7 and 8 apply to the in-app
  drain, which runs when the provider unmounts on a navigation inside the app.
  3. **A queue that KI-36 has marked failed is not flushed**, on either path, by decision.
     Nothing re-sends a change the server refused unless the person asks, and leaving the page is
     not asking. A send that got *no* answer is marked `unanswered` and flushed under its key.
  4. **Units beyond the 48 KiB keepalive budget** are not sent from an unloading page. The flush
     sends the longest prefix of whole units that fits. Board commands are a few hundred bytes, so
     this takes an unusually long queue.
  5. **A mobile tab killed in the background without a `pagehide`** sends nothing. Mobile Safari
     does this; `useEditSession` notes it.
  7. **Editing the trip again before an in-app drain has finished.** The returning board's sender
     doesn't wait for the old provider's drain, so a new edit can land between two drained units.
     Nothing is lost or applied twice, but the log's order isn't the order the person made the
     edits. This stays open because making the sender wait would let one hung request block every
     later edit to the trip. KI-2026-10-14-a is the chat queue, which does wait, and it shows that
     hang. Since window 6 closed, the same holds on `pagehide` in this state: the returning
     provider's queue and the old drain's units go as two keepalive batches, which can reach the
     server in either order (and share the browser's 64 KiB keepalive allowance, so this is also
     where item 4 bites first).
  8. **A drained unit the server refuses** is dropped, and the units behind it are still sent.
     Nobody is left to show the refusal to. A later unit that depended on it is refused by the
     domain on its own; one that didn't is persisted without it.
- **What closed** (the history is in `git log --follow` of this file, ADR-066, and
  `docs/retros/2026-09-25-ki-sweep-overnight.md`):
  - *2026-07-20 to 2026-09-22:* the queue's other triggers, through KI-36, KI-42, KI-55, KI-70
    and KI-90, plus `applyOutcome` re-predicting the queue (M13 link 3). M8 added the
    `SyncIndicator` ("Saving…" / "All changes saved").
  - *2026-09-25:* queued units are flushed as one keepalive batch on `pagehide`. On an in-app
    navigation they are drained unit by unit (`drainAfter`). Proof: `e2e/m6-unload-flush.spec.ts`
    went from `Expected: 4 / Received: 1` to green, and the provider and `unloadFlush` tests were
    each seen red. A server-side batch retry covers the `events_stream_seq` race.
  - *2026-10-06 (ADR-066, migration `0041_command_receipts`):* residuals 1 (the flush overlapping
    the unit in flight) and 2 (the flush overtaking it) closed. Every unit carries an idempotency
    key. The flush carries the whole queue, the unit in flight included, and the server applies a
    unit once, so what persists is always a prefix of what the person did. Proof: "keyed units
    (ADR-066, KI-5)" in `commands.int.test.ts`, `commands.keyedRace.int.test.ts`, and the e2e
    case where the head never reaches the server.
  - *2026-10-25 (KI sweep 2):* residual 6 (closing the tab while an in-app drain runs) closed.
    `drainAfter` now holds, per trip, every unit it has not had answered, the provider's head on
    the wire included (the provider hands it over with its send), and listens for `pagehide`
    itself while it holds any: it flushes them as one keepalive batch through
    `unloadFlushAfterHead`, the unit on the wire first under its key, and sends none of them
    again unless the page survives and the batch was refused. Proof: three new cases in
    `TripProvider.test.tsx`'s KI-5 block. "on pagehide during an in-app drain…" failed
    `expected "vi.fn()" to be called 1 times, but got 0 times` on the unchanged code, and
    "on pagehide part-way through an in-app drain…" failed reading a batch that was never sent;
    "sends what a refused pagehide batch held one unit at a time…" and "a finished drain flushes
    nothing on a later pagehide" were each seen red by breaking the line they guard. 80/80 in
    that file green after.
- **Why not fixed:** 3 is a decision (Mitchell, 2026-07-20: no `beforeunload` prompt, nothing that
  delays leaving). 4 and 5 are browser limits. 7 and 8 trade one hung request blocking a trip against
  out-of-order or unannounced drained units, and nobody has chosen to change that trade.
- **Cross-reference:** ADR-066; KI-36, KI-42, KI-55, KI-70, KI-90, KI-2026-09-05-p (resolved);
  KI-2026-09-14-e (resolved: the stale board after a drain); KI-2026-10-14-a.
- **First noted:** 2026-07-20 (M6, post-merge CI investigation). Rewritten to its residuals on
  2026-10-17 (the 2026-10-16 audit, §6).
