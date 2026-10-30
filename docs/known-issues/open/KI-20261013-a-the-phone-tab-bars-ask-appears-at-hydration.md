### KI-2026-10-13-a — the phone tab bar's Ask appears at hydration, not in the server HTML

- **Severity:** cosmetic. Nothing is wrong once the page has hydrated. On a phone the Ask item
  is missing from the first paint and pops into the tab bar a moment later.
- **Area:** `apps/web/src/components/nav/phoneAsk.ts` (`usePhoneAskEntry`, whose registration
  is an effect, a layout effect since PR 601, and `usePhoneAsk`, whose server snapshot is `null`),
  `apps/web/src/components/nav/PhoneTabBar.tsx` (`PhoneAskTab`), mounted once by
  `apps/web/src/app/(app)/layout.tsx`.
- **Symptom:** `PhoneAskTab` draws only once a screen has registered an entry through
  `usePhoneAskEntry`. Registration runs in an effect, so it never happens in the server render
  and the tab bar's Ask is never in the server HTML. It appears at hydration. This is the same on
  every surface that registers one: the trip board, the notebook index and its pages, Home, and
  the playbook pages (M45 D9).
- **The same gap on a tab switch, closed for the trip's tabs (M54 part 4, PR 601).** Moving
  between a trip's Board and Notebook is a path change: the screen that registered the entry
  unmounts behind the `(board)` loading boundary, and the next registers only once its trip
  lands, so the Ask left the bar for 0.5–2.9s (Mitchell's M54 phone walk: "The ask button keeps
  disappearing and reappearing when I switch between the other tabs"). `PhoneAskTab` now holds
  the last entry it saw in a trip, disabled, onto that trip's board and notebook index until
  the next screen registers (`useHeldPhoneAsk`); another trip, the account pages and a notebook
  page start empty as before. **Seen on a device:** Mitchell's walk of `main` at `e9a46b0f`
  (2026-10-27, 01:51Z, Android, phone width) confirmed that Board↔Notebook keeps the Ask tab in
  place, greyed briefly. That half is closed; this entry stays open for the first-load gap below. A first load, the case above, still has nothing to hold. A
  screen that settles on no Ask ends the hold (`useDeclinePhoneAsk`): the board's error and
  sign-in states, the notebook index's failed read, and a demo trip's board and notebook index,
  neither of which offers an Ask, since `/ask` refuses a demo trip (KI-079). Notebook index
  → a notebook page still drops the Ask for that page's load, by design, since a locked page
  offers none. The hold is a second, bar-local source for whether an Ask is offered, beside
  the registration; the declaration below should replace it rather than sit beside it.
- **Closed for every surface with an assistant, 2026-10-30 (M56 part 14, PR 655).** Mitchell on
  production: "when you first click into a trip, the ai ask button isn't there then it renders
  in", and from Playbooks, Trips redrew the bar without its last item, which then flickered in.
  Both were this gap: a trip's board registers only once its read lands (`boardRenders`), and
  `/playbooks` and `/home` are under different layouts (`app/playbooks/live/layout.tsx`,
  `(app)/layout.tsx`), so the move remounts `AppShell` and the bar starts again with nothing
  registered. The bar now draws the item from the route (`routeOffersAsk`): Home, every screen
  of a trip (its board, notebook index and notebook pages), and the playbook pages with an
  assistant, Discover (`/playbooks`, under PR 656's `(discover)` group and its loading frame),
  a shared day, and a city's or a tag's days. It is pending until the screen registers, so it is
  in the server HTML and in every frame after a move (`m56-shell-first-paint.spec.ts`), and a
  tap meanwhile opens the screen's assistant once it registers. That replaces `useHeldPhoneAsk`
  (`useDeclaredPhoneAsk`); declines still end it, a locked notebook page's among them. Not by
  plan (Mitchell, PR 655 review: "Render everywhere, keep behavior consistent"): a reader
  without the assistant gets the same item on every one of those pages, the playbook pages'
  included, and opens it onto the rail's call to upgrade, which sends nothing to `/ask`.
  **Still open:** the bar itself still remounts between `/playbooks` and the `(app)` routes,
  invisibly now that both first renders agree; one shell over both needs the playbooks tree
  moved. The leaderboard, a profile and a country's days have no assistant at all, so no Ask.
- **What it means for M45 decision 3** ("the Ask is in the first paint, with no flash"): it
  holds from the `md` width up, where the page head's Ask is drawn from the served plan
  (`PlaybookAskButton`, PR 427) and is in the server HTML. On a phone, where the head Ask is
  hidden by `max-md:hidden`, it holds since PR 655: the tab bar's is drawn from the route.
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
  has a single source for whether an Ask is offered (ADR-068). That folds in `useHeldPhoneAsk`
  and its declines: a page's declaration is known before its read lands, so nothing need be held.
- **First noted:** 2026-10-13, M45, PR 427 review round 2.
