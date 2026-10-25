### KI-2026-10-24-i — Trip History's Undo does not undo a notebook's *Reset to default*

- **Severity:** correctness (expectation). The reset itself is recoverable, but only from one
  place.
- **Area:** `apps/web/src/components/pages/PageScreen.tsx` (the *Undo reset* banner, about line
  1533); `apps/web/src/server/pageCommands.ts` `resetPageToDefault`; Trip History's undo, which
  acts on the trip aggregate only.
- **Symptom / What happens:** after *Reset to default* on a notebook (M52's *Today* relies on
  it), Trip History → Undo does not bring the old page back. Only the page's own *Undo reset*
  banner does.
- **Why not fixed here:** prose-only part 0, and undo over pages is deliberately unbuilt:
  KI-2026-09-22-c explains why wiring History's undo to the page aggregate naively would delete
  notebooks. Until that lands, either keep a way back to the reset in the page's own history, or
  say on the reset confirm that History cannot undo it.
- **Cross-reference:** KI-2026-09-22-c; M52 decision 9 (Reset to default instead of restoring
  deleted notebooks; the candidate *Recently deleted: restore any notebook*).
- **First noted:** 2026-10-24, M52's walk of part 9.
- **Re-verified 2026-10-25 (KI sweep 2), and it is worse than written.** History's Undo does not
  just miss the reset. It takes back the trip change *behind* it, because a page-only batch never
  enters the undo stack (`deriveUndoRedo`, `packages/domain/src/trip/history.ts`). A scratch
  integration test (not kept) ran CreateTrip, AddDay, an edit of *Today*,
  `resetPageToDefault` and then `UndoLastChange`. It printed `undo ok: true | page title after
  History undo: Today | has our words: false | days before/after: 1 0`: the reset stayed, and the
  day was removed. Left open for a product call: what History's Undo should mean for a notebook
  (this entry's two interim directions, or page batches in the undo stack, which is
  KI-2026-09-22-c's design).
