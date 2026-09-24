### KI-2026-09-24-m — tag chips on phone stop cards are 20px tall, under SPEC §13.1's 44px floor

- **Severity:** minor usability — they are tappable (they dim everything that is not that tag) but small.
- **Area:** the stop card's tag chips in `apps/web/src/components/board/ActivityCard.tsx`; `e2e/m26-phone-targets.spec.ts` (the floor check, which names its exceptions).
- **Symptom / What happens:** measured 2026-09-24 at 390px: chips are 43×20 and 60×20. They and the notebook breadcrumb (93×30) are the only phone controls under 32px apart from MapLibre's attribution links (known, accepted).
- **Why not fixed here:** a 44px chip changes the card's density; wants a design call (a larger hit area without a larger visual, or exempt them in the floor check with a reason).
- **Cross-reference:** SPEC §13.1, KI-2026-09-24-j (the tablet half of the same floor).
- **First noted:** 2026-09-24, mobile check.
