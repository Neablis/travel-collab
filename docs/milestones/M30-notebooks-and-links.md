# M30 — Notebooks with one job each, and links between them

**Status:** Minted and built 2026-09-26 on Mitchell's request, in chat, on the
`plan-page-ui-redesign` stack (branch `claude/plan-page-ui-redesign-lj6l80-notebooks`,
on top of #243). Decision record: **ADR-056**. Not placed in `TODO.md`'s order yet —
that is Mitchell's call.

## Why this exists

Mitchell, 2026-09-26, reading the §36.10b Overview:

> *"I am still not happy with the Overview page. It reads like a massive dump of
> information. I know its a lot of stops, but i guess i wanted it to read more like a
> Professional travel itinerary. Maybe the issues is trying to make the overview do
> everything, and instead we have several notebooks, with different purposes. A great
> feature we are missing is we should have a Link widget that lets you link to other
> notebooks, or pages in the website, maybe with a simple preview of the website rather
> than just rendering a html link"*.

His answers when asked: seed several notebooks into every new trip (reversing
2026-09-12's *"Only 1 notebook per trip is always generated"*); the Overview is
**"Letter + full daily schedule"**; two separate link widgets.

## Scope

1. **Four seeded notebooks** (`packages/pages/src/templates.ts`):
   - **Overview** (undeletable) — a two-sentence letter; *Dates · Route*; **Day by day**,
     the printed itinerary; **Also in this trip**, a card to each of the other three.
   - **Before you go** — time difference, weather, know before you go, documents and
     packing lists.
   - **Bookings** — still to book, where you sleep, getting between places, what needs you.
   - **Money** — spend by day, costs broken down, a notes prompt.
   Existing trips are untouched: seeding runs only on a trip with zero pages.
2. **The printed itinerary**: `day.detail {view: "schedule"}` — every stop in time order,
   time in the data face, place, and *To book* / *Travel* when it is news
   (`ItineraryScheduleBlock`). Preset "The days, as an itinerary".
3. **`link.internal`** — a card for a notebook, a day or a Plan/Calendar/Map tab, stored
   as ids (`LinkTarget`). Chosen in a search-as-you-type combobox of what exists, each
   option with a line from the trip's data; the card previews the target the same way
   and navigates on click. A deleted notebook says so.
4. **`link.external`** — an address and optional words, drawn as an inline link that
   opens in a new tab with `rel="noopener noreferrer"`. http/https only, checked by the
   params schema. No fetch, no preview.
5. **The notebook list says what each notebook says** (`PageListEntry.preview`), shown
   in the Notebook index and on link cards.

## Out of scope

- A website preview for external links (a server fetch on the reader's behalf).
- Playbooks as a link target (their routes need a signed-in reader).
- The assistant composing links (`composable: false`, ADR-056 decision 6).
- Re-seeding existing trips, or adding cards for notebooks made after seeding.
- The public API: `GET /v1/…/pages` keeps returning `PageSummary`.

## Exit gate

- [x] **A new trip has the four notebooks, in order, and only the Overview is marked** —
      `templates.test.ts`, `pages.int.test.ts` (read back from Postgres, including a
      sibling deleting), `m7-solo-delight.spec.ts`, `m30-notebooks-and-links.spec.ts`.
- [x] **Every seeded widget reads well on an empty trip**, dateless and with dated empty
      days, at first paint and after load; the Overview's cards find their notebooks —
      `templates.test.ts`, seen red with the seeder building from placeholder ids.
- [x] **A link stores ids and survives what ids survive**: a rename, a deletion (honest
      line), a removed day — `link.test.ts`, `LinkTargetPicker.test.tsx`.
- [x] **An external link is http/https or nothing**, at render, at insert and in the page
      write check; it opens in a new tab without an opener or referrer — `link.test.ts`,
      `MacroView.test.tsx`, the e2e.
- [x] **Read-only visitors get no link they cannot follow** (demo, invite look), and no
      card navigates while its page is edited — `LinkCardBlock.test.tsx`,
      `useExternalInputs.test.tsx`.
- [x] **The assistant cannot insert a link** — `pageTools.test.ts`, `registry.test.ts`.
- [x] Contract entry in `docs/contracts/CHANGELOG.md`; ADR-056 written.
- [ ] **[walk]** On the preview: a new trip's four notebooks; the Overview reading as an
      itinerary on the Japan demo; insert an internal link to Money and follow it; insert
      an external link and open it.
- [ ] **[walk]** Mitchell reads the Overview on the Japan demo and says whether it now
      reads like a professional itinerary.
- [ ] A retro is appended at gate close.
