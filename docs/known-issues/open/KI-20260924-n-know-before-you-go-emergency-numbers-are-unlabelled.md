### KI-2026-09-24-n — "Know before you go" shows emergency numbers without saying which service each one reaches

- **Severity:** minor. A traveller reading "110 · 119" for Japan cannot tell police from ambulance/fire. The table orders them (general first, then police, ambulance, fire), but that order is written in the data file header and not on the card.
- **Milestone:** M14, carried rather than gating. Filed on PR #221 with T19.
- **Area:** `packages/pages/src/data/countries.ts` (the `emergency` field is a flat list of strings), `apps/web/src/components/pages/blocks/CountryFactsBlock.tsx`.
- **Symptom / What happens:** each card's emergency row is the numbers joined by " · ", with no label on any of them.
- **Also:** ~~about 45~~ 57 (counted 2026-09-25) countries (mostly Central/West/East Africa, several Pacific states, KP, TM, AF, MM, IQ, SY, YE) have `emergency: null` and render "—", because the values could not be stated with confidence. The T19 report on PR #221 lists the filled-in values most worth a human check.
- **Why not fixed here:** a `{ number, for }` shape doubles the facts that have to be verified, and nothing from this container can reach a source to verify them against.
- **First noted:** 2026-09-24, M14 T19.
- **Re-verified 2026-09-25 (overnight sweep):** still true, and the null count
  is higher than stated. `emergency` is still `readonly string[] | null`
  (`countries.ts:48`), joined with `" · "` and no labels
  (`packages/pages/src/macros/primitives/countryFacts.ts:58`); Japan renders
  `110 · 119`. Counting `COUNTRIES` (`node --experimental-strip-types`):
  **57 of 244** countries have `emergency: null`, not ~45 — the extra are mostly
  more Pacific states (TL, CK, FM, KI, MH, NR, NU, PG, PN, TK, TV, UM, VU, WF,
  WS) plus EH, LY, SD, SS, LS, NA, SH.
