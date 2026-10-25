### KI-2026-10-24-j — a reader the chat refuses sees the *Trip chat* card's skeleton, then the card vanishes — DOWNGRADED

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
- **Downgraded:** 2026-10-25, KI sweep 2. Production never reaches this. The notebook is drawn
  only once `GET /api/trips/:id` answers (`PageScreen`'s load sets `status: "error"` if that read
  fails). That route, `GET /api/trips/:id/access` and the page read all pass the same gate,
  `requireTripAccess(tripId, "viewer", { allowDemo: true })`, and the chat's `chatAccess` asks it
  too. So a reader the access read refuses also has the trip refused and gets the error screen.
  They never see a *Trip chat* card. A share link's reader never reaches a notebook, because
  `/s/<token>` draws none, as the entry says.
  Reproduced both ways in `PageScreen.test.tsx` with scratch tests that were not kept:
  - With the test fixture's mock, which refuses `/access` but serves the trip (no real server
    does this), the frame is drawn (`aria-busy= true skeletons= 2`) and then disappears.
  - With both reads refused, as the real server answers, the output was
    `card ever drawn = false | body: forbidden`.

  One case remains. A member removed between the trip read and the access read could see the
  frame and then lose it, but that is a removal, and the card goes in that case anyway. No code
  change.
