### KI-2026-10-19-k — Overlapping publish-offer dismissals can store a dismissal whose own save failed — RESOLVED

- **Severity:** cosmetic. The offer the reader asked to dismiss is dismissed after all; nothing
  unasked is hidden.
- **Area:** `apps/web/src/components/account/PreferencesProvider.tsx:188-198` (the dismissal
  callback; the comment at line 195 records the trade-off).
- **Symptom / What happens:** dismiss the offer on two trips quickly. If the first save fails and
  the second (sent later, carrying both ids) succeeds, the first trip's offer is stored as
  dismissed although its own save showed an error.
- **Why not fixed here:** accepted in PR 499: the reader did ask to dismiss that trip, so the
  result matches intent. The close is prose-only.
- **Fix direction:** if it ever matters, serialise the saves (queue each behind the last) so a
  failed one is dropped before the next is built.
- **Cross-reference:** M50 part 7 (PR 499); M50 decision 7.
- **First noted:** 2026-10-19, M50 part 7 (PR 499), accepted in the comment at line 195.
- **Resolved, 2026-10-24 (KI sweep):** the entry's fix direction. `dismissPublishOffer` queues each
  dismissal save behind the one before it, so the next list is built after a failure has dropped
  its trip. Reproduced first with a new `PreferencesProvider.test.tsx` case (Dismiss "a", Dismiss
  "b" while "a" is in flight, fail "a"): the second patch carried `["a", "b"]`, `AssertionError:
  expected { Object (dismissedPublishOffers) } to deeply equal { dismissedPublishOffers: [ 'b' ] }`;
  green after the fix. The existing "carries an earlier dismissal whose save has not answered"
  case pinned two saves in flight at once, which is the behaviour this removes; it now pins one in
  flight and the second carrying the first after it answers, and was seen red by building the list
  without `dismissedHere`. The cost: a second Dismiss pressed quickly answers one round trip later.
