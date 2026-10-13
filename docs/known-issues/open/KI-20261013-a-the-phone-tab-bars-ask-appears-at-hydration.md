### KI-2026-10-13-a — the phone tab bar's Ask appears at hydration, not in the server HTML

- **Severity:** cosmetic. Nothing is wrong once the page has hydrated. On a phone the Ask item
  is missing from the first paint and pops into the tab bar a moment later.
- **Area:** `apps/web/src/components/nav/phoneAsk.ts` (`usePhoneAskEntry`, whose registration
  is a `useEffect`, and `usePhoneAsk`, whose server snapshot is `null`),
  `apps/web/src/components/nav/PhoneTabBar.tsx` (`PhoneAskTab`), mounted once by
  `apps/web/src/app/(app)/layout.tsx`.
- **Symptom:** `PhoneAskTab` draws only once a screen has registered an entry through
  `usePhoneAskEntry`. Registration runs in an effect, so it never happens in the server render
  and the tab bar's Ask is never in the server HTML. It appears at hydration. This is the same on
  every surface that registers one: the trip board, the notebook index and its pages, Home, and
  the playbook pages (M45 D9).
- **What it means for M45 decision 3** ("the Ask is in the first paint, with no flash"): it
  holds from the `md` width up, where the page head's Ask is drawn from the served plan
  (`PlaybookAskButton`, PR 427) and is in the server HTML. **It does not yet hold on a phone.**
  There the head Ask is hidden by `max-md:hidden`, so the first HTML has no visible Ask, and the
  tab bar's appears at hydration. PR 427 removed the wait for the plan read, so the delay is now
  hydration only, not a network round trip.
- **Why it is left like this:** it predates M45 part 5 and is the same on every surface, and a
  fix is cross-surface. The tab bar is mounted in the layout, above the page, so it cannot know
  from its own render whether the page below offers an Ask. That needs a new contract between the
  layout and every page, not a playbook change (PR 427 review round 2).
- **Fix direction (not yet chosen):** let the tab bar know at server render whether the page
  offers an Ask, and keep the effect only for wiring up what the Ask opens:
  1. each page that offers an Ask declares so in its server render, for example through a
     provider under the layout that the page sets, or a per-route flag the layout reads;
  2. `PhoneAskTab` draws the item from that declaration, gated by the served plan where the
     surface is plan-gated, as `PlaybookAskButton` already is;
  3. the registration still supplies `onOpen` and `onAsk`, as it does today. Before hydration a
     tap does nothing, which is acceptable, as it is for the head Ask.
  Every surface that registers an entry moves to the declaration together, so that the tab bar
  has a single source for whether an Ask is offered (ADR-068).
- **First noted:** 2026-10-13, M45, PR 427 review round 2.
