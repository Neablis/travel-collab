### KI-2026-09-24-k — the Calendar lens clips its week on the right below desktop width

- **Severity:** cosmetic/usability — the hidden days are reachable by scrolling sideways, but nothing says so.
- **Area:** `apps/web/src/components/lenses/CalendarLens.tsx`.
- **Symptom / What happens:** measured 2026-09-24: at 820px about 5.5 of 7 weekday columns show and Fri/Sat need a sideways scroll; at 1024px Saturday is clipped; at 390px ~2.5 columns show (a phone reaches Calendar only by URL, which matches SPEC §10's two-views rule).
- **Why not fixed here:** out of the stop-editor fix's scope; wants a narrow-width Calendar decision (fewer columns, week paging, or a visible scroll affordance).
- **Cross-reference:** screenshot `09-calendar-820.png` from the 2026-09-24 check.
- **First noted:** 2026-09-24, mobile check.
