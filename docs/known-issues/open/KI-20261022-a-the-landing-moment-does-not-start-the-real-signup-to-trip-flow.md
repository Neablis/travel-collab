### KI-2026-10-22-a — The landing's "make it your trip" moment does not start the real signup → new-trip flow

- **Severity:** correctness. A promised conversion path is missing: the landing's day can't be
  carried through signup into a new trip.
- **Area:**
  - `apps/web/src/components/front/` (`LandingSea.tsx`, `LandingFeaturePanels.tsx`,
    `PhoneFrontDoor.tsx`): the landing's CTAs link to plain `/signup` or to a day page, and
    nothing on `/` banks a day before signup.
  - `apps/web/src/lib/pendingPlaybookAdd.ts` (`rememberPlaybookAdd`, `takePlaybookAdd`) and
    `apps/web/src/components/playbooks/SignInToAddDialog.tsx`: the existing flow from a day page,
    which the landing would reuse.
  - `apps/web/src/components/playbooks/SharedDayScreen.tsx` (the `takePlaybookAdd` effect) and
    `apps/web/src/components/home/HomeScreen.tsx` (the lost-callback fallback).
- **Symptom / What happens:** signed out on `/`, there is no CTA that goes sign up →
  *Making your trip…* → a new undated trip holding the landing's day. A signed-in visitor does not
  get the add-to-trip choice from the landing either (M50 decision 15). No e2e covers the path.
- **Why not fixed here:** M51's decision 10 asked for it, and the plan gave it to part 6. During
  the build the design changed: part 6 (PR 514) became the assistant moment, drawn as the real
  assistant after Mitchell's walk, and a later pass removed many tests because the suite was too
  slow. Mitchell, 2026-10-22: file it as a known issue and close M51 without it.
- **Fix direction:** give the landing moment a *Make this your trip* CTA that calls
  `rememberPlaybookAdd` with the day's production id on click (not on render, so `/` stays static
  and fetch-free) and links to `/signup?callbackUrl=<the day page>`, as `SignInToAddDialog` does.
  The return path already exists. Cover it with one e2e that seeds the day through
  `api/dev/saved-days` (the e2e DB has no library days), seen red, run with ci-like.
- **Cross-reference:** M51 (`docs/milestones/M51-the-front-door-tells-the-story.md`), decision
  10 and the gate box *Make it your trip*; M50 decisions 5 and 15; PR 497 (M50 part 4's flow).
- **First noted:** 2026-10-22, M51's gate close.
