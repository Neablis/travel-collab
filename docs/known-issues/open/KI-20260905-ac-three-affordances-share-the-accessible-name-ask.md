### KI-2026-09-05-ac — three unrelated affordances share the accessible name "Ask" on the phone plan; a three-day trip has seven of them

- **Severity:** correctness (accessibility / voice control) — **confirmed by measurement**, but the *fix* is a naming decision and therefore Mitchell's call, not a build one. No visual symptom; the cost lands on voice-control users and, secondarily, on every test that has to reach one of these controls.
- **Area:** `apps/web/src/components/assistant/AskPill.tsx` (SPEC §23's header pill), `apps/web/src/components/assistant/AssistantRail.tsx` (the composer's submit button), and `apps/web/src/components/lenses/TimelineLens.tsx:360` (SPEC §9's per-stop ask, wrapped in `Preview`). The workarounds are at `apps/web/e2e/m16-mobile-assistant.spec.ts:44` and `apps/web/src/components/pages/PageScreen.test.tsx` (`askPill()`).
- **Symptom / What happens:** on the phone plan, `getByRole("button", { name: "Ask" })` resolves to **seven** elements on the seeded three-day trip, and each name is individually correct:

  | Control | Where | Count on `threeDayTrip` | What it does |
  |---|---|---|---|
  | §23's `Ask` pill | trip header, top row | 1 | opens the assistant sheet |
  | per-stop `Ask` | every Timeline card | 6 (one per stop) | §9's per-stop ask — currently inside a `Preview` shell, so inert but present in the a11y tree |
  | the composer's submit | inside the open sheet | +1 once the sheet is open | sends the typed question |

  Six stops plus the header pill is the seven the e2e measured with the sheet shut; opening the sheet makes it eight. The same collision exists at unit scale with no stops at all — the phone-sheet render of `tripDetailFixture()` resolves two.

  **The names are not the bug; the collision is.** `AskPill`'s accessible name is deliberately its visible label — an `aria-label` that disagreed with the word on the control would break WCAG 2.5.3 (label in name), which is exactly the failure mode of "click Ask" landing on a control not called Ask. That reasoning is recorded in `AskPill.tsx` and is still right. What it does not answer is what happens when a voice-control user says *"click Ask"* on a screen carrying seven of them: the tool falls back to numbering the matches, so a one-word command becomes a command plus a disambiguation step, on the surface (a phone) where that costs the most.

- **Why this is not just a test problem:** both suites already work around it, and the workarounds are honest ones — the e2e scopes to `header[aria-label="Trip"]`, `PageScreen.test.tsx` discriminates on `aria-expanded` because the pill is a disclosure and the submit button is not. Neither is a hack, and neither helps a person driving the screen by voice. Recording it as a *test* issue would file it under the surface where it is cheapest and leave the expensive half unstated.
- **Why not fixed here:** the fix is naming, and every option is a product decision with a visible cost:
  1. rename one of the three visibly — which changes copy §23 and §9 both specify, on controls the design draws;
  2. leave the visible words alone and lengthen one accessible name so it still *contains* the visible label (2.5.3 is a containment rule, not an equality one) — cheaper, but it makes the name and the label differ, which is the thing `AskPill`'s comment is careful about;
  3. accept the collision and record that voice disambiguation is the expected interaction.

  No replacement copy is proposed here on purpose. Picking words for §23's pill or §9's per-stop ask from the build side is the drift `docs/known-issues/open/KI-20260905-aa-…` describes in the other direction.
- **Suggested next step:** put the three options above to Mitchell with the count attached, and decide which control is the one that changes — the per-stop ask is the strongest candidate on volume alone (it is six of the seven, and it is the one that is still a `Preview` shell rather than shipped behaviour), but that is a judgement, not a finding. Whatever is chosen, the e2e's scoped locator and `PageScreen.test.tsx`'s `expanded` discriminator can then stop being disambiguators and go back to being ordinary queries.
- **Cross-reference:** `SPEC.md` §23 (the pill, its label and its position); `SPEC.md` §9 (the per-stop ask); WCAG 2.5.3 *Label in Name*; `KI-2026-09-05-aa` (the §23/§2i premise); `AskPill.tsx`'s header comment, which carries the reasoning this entry does **not** overturn.
- **First noted:** 2026-09-05, wiring §23's surface-derived `emptyHint` through `AssistantRail` — the count came out of the e2e locator that already had to work around it.
