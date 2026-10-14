### KI-2026-10-14-b — a chat send queued behind a failed one comes back joined to it, without its link

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
