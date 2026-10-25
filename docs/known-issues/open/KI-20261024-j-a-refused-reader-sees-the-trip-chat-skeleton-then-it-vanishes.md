### KI-2026-10-24-j — a reader the chat refuses sees the *Trip chat* card's skeleton, then the card vanishes

- **Severity:** cosmetic. The page shifts once under a reader who was never going to get a chat.
- **Area:** `apps/web/src/components/pages/PageScreen.tsx` (`accessPending`, about line 1070, and
  the `usePhoneAskEntry` call after it); `components/pages/blocks/ChatRecentBlock.tsx` (the
  `pending` skeleton).
- **Symptom / What happens:** on a notebook opened by a reader the access read refuses (a share
  link's, decision 20), the card draws its busy skeleton while the read is out, because a trip
  with nothing known "can have a chat". When the read answers 4xx the widget is absent, so the
  space it held collapses. PR 537 rounds 17 and 18 built the skeleton to stop the card arriving
  late for members; for a refused reader it now leaves late instead. Read from `main` at
  `a06fe13` (code reading, not a browser walk). The public `/s/<token>` page
  (`SharedTripScreen`) renders no notebook, so it shows no card at all.
- **Why not fixed here:** prose-only part 0. Fix direction: hold the place only when the screen
  already knows the reader is a member (a signed-in session the trip lists), or let the
  skeleton collapse without shifting the content below it.
- **Cross-reference:** M52 decision 15 (Trip chat) and 20 (share-link readers); ADR-073.
- **First noted:** 2026-10-24, Mitchell's walk of part 8, rechecked against round 18.
