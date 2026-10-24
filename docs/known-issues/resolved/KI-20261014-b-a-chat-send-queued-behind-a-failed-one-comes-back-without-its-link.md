### KI-2026-10-14-b — a chat send queued behind a failed one comes back joined to it, without its link — RESOLVED

- **Severity:** cosmetic, with a small loss. The words come back, but the second send's @day or
  @stop link does not, and the reader has to pick it again.
- **Area:** `apps/web/src/components/chat/useTripChat.ts` (`post`: the failure branch builds
  `unsent` from the queued lines' bodies only) and `apps/web/src/components/chat/ChatPanel.tsx`
  (`send`: restores the picker's `held` target of the send that failed).
- **Symptom:** send "Train at nine?", then send "or ten?" linked to a day, before the first POST
  answers. The first fails. Both lines are taken back. The first send resolves to "Train at nine?
  or ten?", which goes into the composer as one draft, and the second resolves `null`. Only the
  first send's link is restored, and the second's is dropped. Pressing Send then posts one message
  where there were two, with at most one link.
- **Why not fixed here:** the composer holds one draft and one picked target, so it has nowhere
  to put a second link. Either the hook returns the unsent lines (each with its body and link) and
  the panel gives them back one at a time, or the composer learns to hold several links. Both are
  larger than the walk fix in PR 444.
- **Cross-reference:** KI-2026-10-14-a (the same queue).
- **First noted:** 2026-10-14, M46 walk, PR 444 review (finding 1 of the review of `1208ed3`,
  filed per finding 1 of the review of `c33ef09`).
- **Resolved:** 2026-10-24, KI sweep. The entry's first option. `useTripChat`'s `post` no longer
  joins the taken-back lines: each send resolves to its own `Unsent` (`{ body, behind }`), the
  failed head first and the sends queued after it `behind`, in the order sent. `ChatPanel`
  restores the head with the picker as it was at its own Send (unchanged), and keeps each
  `behind` send, with its own picker state, in a `waiting` list. The next one comes back once the
  send before it is stored and the composer is empty, so each retry carries its own @ link. They
  are dropped with the head when the reader had started another message, as the head already was.
  Reproduced before the fix with the real hook and panel together (first POST held, then failed):
  the composer got `"Train at nine? or ten? @Day 1"`, and Send stored one message where there had
  been two. After the fix, the same run gives back `"Train at nine?"`, then `"or ten? @Day 1"`
  once that is stored, and the POSTs are `"Train at nine?"` and then `"or ten? @Day 1"` with
  `{ kind: "day" }`. Regression: `ChatPanel.test.tsx` "a send queued behind one that fails" (two
  tests), and `useTripChat.test.tsx` "go back together … each with its own text". Each was seen
  red against a targeted break (the queued send restored without its picker state, the drop
  ignored, and the hook resolving `null` for a queued send).
