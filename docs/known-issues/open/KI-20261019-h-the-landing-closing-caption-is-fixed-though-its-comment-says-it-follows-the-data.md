### KI-2026-10-19-h — The landing's closing caption "Day six, Hakone" is a fixed string, though its comment says it changes with the data

- **Severity:** cleanup. Nothing is wrong today; the comment misleads the next person who changes
  the demo day.
- **Area:** `apps/web/src/components/front/LandingScreen.tsx:303-305` and
  `apps/web/src/components/front/PhoneFrontDoor.tsx:562-565`; the demo data in
  `apps/web/scripts/landing-demo.ts:231` (`MEMORY_DAY`).
- **Symptom / What happens:** both comments say the caption *"names the day
  `scripts/landing-demo.ts` writes ("Day six, ") and changes with it."* The caption is a literal;
  if `MEMORY_DAY` changes, the caption keeps naming day six until edited by hand.
- **Why not fixed here:** accepted as minor by PR 500's re-review of `d29c620`; the reviewer
  chose not to re-run CI for a comment. The close is prose-only.
- **Fix direction:** reword both comments ("a literal; change it by hand with `MEMORY_DAY`"), or
  derive the caption from the generated landing data. Ride the next change to the landing.
- **Cross-reference:** M50 part 5 (PR 500).
- **First noted:** 2026-10-19, PR 500's re-review.
