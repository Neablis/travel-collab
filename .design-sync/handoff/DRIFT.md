# Design ↔ build drift — Caesura / travel-collab

Design: `Trip Planner Redesign.dc.html` (desktop + phone surfaces, landing, auth, first run).
Build: `Neablis/travel-collab@main`, read from the attached working tree, 2026-08-26.
Design side refreshed 2026-09-05 (§2h the phone tab bar is scoped; §2g the notebook widget
framework; §2f the phone Notebook; §2c billing surfaces; §2d the shared-day map and the phone
Playbooks tab; §2e Notebook widgets — pages no longer have a scope).

This is a **current-state** document. It replaces the append-only log that ran
2026-08-22 → 08-26; everything already closed is condensed into §5 rather than kept
in full. Two files are authoritative on the build side and are not restated here:
`apps/web/src/lib/preview-registry.ts` (18 shelled-but-unwired surfaces, each with a
milestone) and `docs/known-issues.md` (KI-nn). Preview-wrapped UI is *designed and
shelled, not missing* — it is not a design gap.

---

## 1. Open drift — code and design disagree

| # | Thing | Code | Design | Call |
|---|---|---|---|---|
| **D1** | Product name | `AppHeader` says **Trip Planner**; `metadata.title` is `travel-collab` | **Caesura** | Design wins. Still unchanged in code — the oldest open item on this list. |
| **D2** | Unauthenticated home | `app/page.tsx` renders a bare heading + a link to NextAuth's default page | Full marketing landing page, custom sign-in / sign-up | Design wins. **Rewritten this turn — see §2.** |
| **D3** | Trip status badge | `TripHeader` renders a status `Badge` | No badge | Code wins; design should add it back or the build should drop it. Only survivor of the old D5 list. |
| **D4** | New-trip "roughly when?" chips | `CreateTrip` (`contracts/src/trip.ts`) carries **name only** | First-run screen offers date-range chips | Shipped as a Preview-wrapped shell with a dashed border reading "needs a `CreateTrip` field". Contract change, or delete. |
| **D6** | "Next trip" | `TripSummary` has no dates, so `nextTrip` is `visibleTrips[0]` | Upcoming-by-date hero + "in 47 days" countdown derived from `TODAY` / `NEXT_TRIP_START` | **= their KI-34, still open**, and worse than first written: with nothing to sort by, the hero can surface the *wrong trip*, not just the wrong date. Countdown is honest in design and unbuildable until the field lands. |
| **D10** | Billing | Nothing — no `plan`, no `plan_versions`, no `entitlement_grants`, no `is_admin`, no `subscriptions`, no `ai_usage`. `modelSelection.ts:89` is still `EVERYONE_IS_ENTITLED` | Four surfaces: pricing, operator console, the collaboration gate, plan + usage (§2c) | Design is ahead on purpose and blocked on **all** of M20 and M21. Not a defect on either side. |
| **D9** | Playbooks scope | `playbooks-route` shell, private days only | Public search, reviews, ratings, leaderboard, profiles (§2b) | Design is far ahead. Needs `cities[]`, a city search endpoint and a reviews table before it is buildable. |
| **D8** | Landing page has no route | nothing — the unauthenticated branch is four lines | A full screen with a rotating hero and three feature blocks | New with §2. Needs a real marketing route, not a conditional inside `page.tsx`. |

D5 and D7 are closed (§5).

## 2. New this turn — the landing page

`startScreen: landing` is a complete surface with **no counterpart in code at all**.
What a build would have to carry:

- **Rotating hero.** Three views of a Japan trip — Day 5 Notebook, Day 6 Map, Day 7
  Timeline — on a 10s cycle. Clicking a day pill jumps and restarts the timer.
  **The content is hardcoded marketing fixture data, not a live trip.** The page is
  unauthenticated and must render with no session, no fetch and no backend — it looks
  like the product, it is not connected to it. Keep the fixture in the marketing route,
  not imported from the seed importer, so a data-model change can never break the
  front door.
- **Three feature blocks, equal height:** *Together* (live timeline: a lifted stop,
  a comment thread, travel gaps), *Notebook* (prose with an inline, borderless cost
  table — activity / who / cost, Day 6 total $596), *Playbooks* (a borrowed Phuket
  beach day, 4.8★, "Shared 214 times", dropping in as Day 2).
- **Positioning constraints, deliberate:** no "free", no "open source", no "no credit
  card". The only footnote is **Early access**. If marketing copy re-enters, it should
  not re-enter through these claims.

**It is buildable today** — static fixture, no dependency on anything in §3 or §4, and
**deliberately ahead of the build**. Two blocks show functionality that does not fully
exist yet: the Notebook block shows prose with live macro values (SPEC §7, which
`packages/pages/src/templates.ts` contradicts) and the Playbooks block shows a shareable,
rateable day (`playbooks-route`, `insert-playbook`, `add-saved-day` are Preview shells).

**That is the intent, not drift.** A landing page states where the product is going; it
does not wait for the last shell to be wired. Do not file these as blockers and do not
water the page down to what ships today. The one thing that would be a real problem is a
*claim* the product will never honour — the copy makes none, and "Early access" is the
footnote that covers the rest.

Design-file note: decorative SVG layers in the hero are `pointer-events: none` so the
day pills stay clickable. Same trap will exist in any real implementation.

## 2b. New this turn — Playbooks becomes a public library

The Playbooks route was a private grid with a city dropdown and a "coming soon" card.
It is now a **discovery surface over other people's days**, and there is a second route.
Nothing here exists in code; `playbooks-route`, `insert-playbook` and `add-saved-day`
were already Preview shells, and this widens what they owe.

**Playbooks (route `playbooks`)**
- **City search is server-side.** Debounced input → a 30-city index with region and a
  day count, ~240–440 ms simulated latency, and four real states: loading spinner,
  results, "no city matches", and a failure state wired to `syncOff` with **Retry**.
  The old `<option>` city list is gone and should not come back — the design now asserts
  a `GET /cities?q=` style endpoint that does not exist.
- **A day matches on *any* city it contains.** Days carry `cities: string[]`; a query for
  Kyoto returns the Uji day, with the matched city filled and the rest outlined, plus a
  per-card line ("Kyoto matched · also Uji"). Ranking is matched-city count first, then
  the chosen sort. **There is no multi-city field in the contract** — this is the largest
  new blocker on the list, bigger than the missing `tags`.
- **Sibling chips.** Cities that appear in the current result set but not in the query,
  with counts, one tap to add. Empty query shows a "busy right now" city row instead.
- **Filters, four only:** rating floor, month it was run, budget per person, and sort
  (most added / highest rated / most reviewed / newest). `Everyone / Yours / Saved` is a
  scope segment — **your own library is a filter on this page, not a second page.**
- States: skeleton grid while fetching, an `EmptyState` with *Drop the filters* /
  *Search everywhere*, and an offline banner saying ratings are stale.

**Shared day (route `day`, new)**
Full stop list with per-stop notes and city chips, author strip (name, days shared, how
often their days were added), sticky rail with the rating, a 5→1 histogram, the facts
(stops, window, budget each, month, adds) and **Add to a trip** → the existing insert
dialog. Reviews are **stars plus one optional line capped at 140 characters** — anyone
signed in, no gate, and posting recomputes the average live. Empty ("nobody has rated
this yet"), offline (held on device, badged *Queued*) and conflict ("Mei changed this day
two days ago") are all present.

**Leaderboard (route `board`) and public profiles (route `profile`), both new.**
The author strip on a shared day is now a link into the profile. Nothing here exists in code.
- **Leaderboard ranks on real-trip adds only** — not ratings, not post volume. Copy states
  the rule out loud ("an add only counts once per trip, and only after the trip has dates;
  copying your own day into your own trip does not count") because that rule is the whole
  credibility of the ranking, and a build that counts raw inserts will produce a different
  and gameable order. Your own row is tinted and badged rather than pinned to the top.
- **Profiles are derived, never authored.** Every number on the page (adds, days shared,
  average rating, reviews received, cities known) is computed from that person's days, so
  a profile can't disagree with Discover. There is no bio, no follow, no avatar upload —
  a profile answers "is this person worth taking a day from", nothing else.
- The "Knows" city chips run a Discover search scoped to that city, so a profile is a way
  into the library rather than a dead end.
- Back links are contextual: the profile returns to wherever you came from (day, board or
  Discover), because the same page is reachable three ways.
- **Not in the top bar.** The leaderboard is trip-independent but it is not account scope,
  so it is entered from Discover ("Who shares the most") per rule 1 in CLAUDE.md.
- Offline: the board shows a stale-ranking banner. There is no empty state, because the
  board cannot be empty while any day is shared.

**What a build needs before any of this is real:** `cities: string[]` per playbook, a
city search endpoint, public visibility on a day, a reviews table (author, stars, ≤140
char note, created), denormalised `adds` / `rating` / `reviewCount` counters, and — for the
board — an adds ledger keyed by (day, trip) so an add can be counted once and only for a
dated trip. A public user record is NOT needed: profiles are derived from days. Until
the reviews table exists, every rating on this surface is fixture data.

## 2c. New this turn — the billing surfaces (M20 / M21)

`SPEC.md` §17 is the whole design. Four surfaces, **all fixture data**, and the two prices
are placeholders: M21's own prerequisite makes the price Mitchell's decision, and the design
has not made it. What matters for planning:

- **They are blocked on the milestones, not on a field.** M20 introduces an Entitlements
  module to `AGENTS.md`'s module map — structural law, ADR due before it opens. Until M20
  lands there is no plan, no grant, no resolver and no `is_admin`; until M21 lands there is
  no subscription, no MRR and no ARPU. Nothing here is a shell to wire up.
- **The design asserts no new gate.** The two gates it shows are M20 link 4 (AI, 402 with
  `ai-not-entitled`) and link 6 (invites, capped on read). If a diff written against these
  screens touches `modelSelection.ts`, `quota.ts` or `members.ts` during **M21**, that is
  M21's split failing, not the design asking for it.
- **The ladder is presentation only.** Three plan cards nest in copy; nothing in the design
  reads a display order as authority or derives one plan from another. A pricing page is the
  most likely place for M20's enumeration rule to be lost quietly.
- **Publishing and migrating plan versions are deliberately absent from the UI**
  (Mitchell, 2026-09-02), which narrows M20 link 7: the admin surface owes the accounts
  list, effective entitlements, grant history, granting and revoking, and per-tier stats —
  **not** the two plan-version operations. Versions are still immutable and still pinned;
  they are published from the repo. If link 7's exit gate is read as requiring publish-in-UI,
  that gate and this design disagree, and the design is the newer decision.
- **The console is not a product surface**, per link 7, and the design keeps that: plainest
  primitives, no accent language, and it does not exist on the phone — entry point included.
- **Costs-more-than-it-pays is segmented in the UI**, not just in the query: one count for
  paying-and-underwater with a filter into the table, grant-funded accounts counted by
  source and set aside. This is M21 link 7's requirement expressed as layout.

Two smaller notes for whoever builds it. `Money` must not appear on these screens' data
path — a request costing $0.0011 rounds to zero in `amountMinor` (M20 link 9, third
recurrence of that defect class); the console shows dollars derived at read time from tokens
plus a dated rate table. And the account's meters read the **pinned version's** per-user
ceilings; the environment's global ceiling is deliberately not shown, because it was never
sold to anyone.

## 2d. New this turn — the shared-day map and the phone Playbooks tab

Also absent from the previous bundle, which predated both. `SPEC.md` §16.

The shared day draws a map beside its stop list. Three constraints are load-bearing and each
one was a live bug in the design file: the map node stays mounted (a conditional container
detaches it mid-style-load and the load aborts silently — DRIFT §6 build-check 5); pins draw
immediately while lines wait for the style; and style-load recovery is per instance, with a
rebuild at 3.5s and 7.5s and a list-only fallback at 11s.

The phone tab bar is now **Plan / Map / Notebook / Playbooks / Trips** — SPEC §13's four-tab
list is superseded. Phone Playbooks has parity with Discover, with all filters in one bottom
sheet per rule 3 and the shared day's map collapsed behind a "Show route" row.

## 2e. New this turn — Notebook widgets replace page scope

`SPEC.md` §18, which supersedes §7's page-scope model. This is the first item on this pass
that makes the build's job **smaller**, so it is worth reading before the next Notebook diff.

A page no longer has a scope. **Each widget owns its inputs** — a day, a stretch of days, a
person, a tag set, a trip — bound when it is inserted and rebindable in place. Two widgets on
one page can read two different days, and the design demonstrates exactly that.

What the build should stop planning for:

- `PageContext.dayRef` **as a page property**, and with it `PageScreen.handleBindDay` and
  `focusDayBinding`. The binding belongs to the widget instance. These three are real code
  today, which is why §7 keeps the struck text rather than deleting it.
- The page-header day dropdown, the "this page follows Day 6" Banner, the Trip-wide / Day
  badge on the index, and "Following Day 6" on the phone. All four asserted a scope the model
  no longer has, and three of them also duplicated a value already on screen (rule 4).
- Scope as a facet in the insert picker. Scope × shape was a lens over the registry; with
  inputs declared it is a category that does not exist. The picker is now search + shape over
  a flat list, then a **Point it at** step with one control per declared input.

What it needs instead — and this is the part to cost:

- **Inputs are part of the registry entry**, not per-macro special cases: an input *type*
  (`day` / `days` / `person` / `tags` / `trip`) picks the control, so a new widget needs no
  new UI. This is §7's "macro param schema" promoted from one macro's extra to the model.
- **A widget instance stores its bindings** — a page document therefore holds instances with
  arguments, not bare macro references.
- Ranges (`days`) and people (`person`) are new resolver arguments. The design added five
  widgets that use them without inventing a mechanism; that is the test of the model, and it
  is also five resolvers a build now owes.

**It changes the shape of the §4 Notebook blocker rather than clearing it.** See §4.

## 2h. New this turn — the phone tab bar is scoped, and no tab is ever disabled

`SPEC.md` §22. Small, but it changes a component's contract rather than its styling, so it
is drift and not a cosmetic.

The design's phone tab bar is no longer a fixed five-item list. **Its items are a function of
the route**: inside a trip it is Plan · Map · Notebook; everywhere else it is Trips ·
Playbooks. Any build that renders a constant `TABS` array — or renders five with two disabled
— now disagrees with the design.

What a build owes:

- **The tab list is derived, not constant.** One predicate — "is a trip open" — picks between
  two arrays. Do not implement a `disabled` prop on the tab item to get here; there is no
  disabled tab in the design, and adding one invites the next person to use it.
- **The phone Notebook index needs its own `‹ Trips` back link.** With Trips gone from the
  in-trip bar, that header is the only exit. It is in the design file now. A build that ships
  the scoped bar **without** this link strands the user on that screen.
- **The active tab is a `--color-brand-tint` pill behind the glyph** (46×26, fully rounded),
  not a colour swap alone. Existing token, no new colour. If the build's tab item only takes
  an `active` boolean that maps to text colour, it needs the pill too.

**Not checked against code.** The build's phone shell was not re-read this turn, so whether
its tab bar is a constant array is unknown — treat this as "verify", not "fix". It is on the
§6 build-check list.

## 2g. Previously — the widget framework is three components, and one rule needs a call

`specs/notebook-widget-framework.md`, `SPEC.md` §21. ADR-037 says a widget is a module whose
`render` returns typed data and must be total. It does not say what the output *looks like*,
so twenty widgets can satisfy it and still disagree on borders, empty copy and what an
unbound widget shows. The framework closes that: **three components, one per shape**, and a
widget author supplies content only — never spacing, borders, ghost glyphs or empty copy.

What the build gains, and it maps onto ADR-037 directly:

- **`Rendered`'s three arms get one renderer each.** `inline` → `NotebookInline`,
  `block` → `NotebookBlock`, `rows` → `NotebookRepeat`. The repeat's rows **are** inline
  mounts, so there is no second chip renderer to drift — which is the same reason ADR-037
  deletes `MacroView`'s `switch (name)`.
- **Four states per shape**: `ok`, `ghost`, `empty`, `stale`. This is the concrete form of
  decision 6's "renders in every state", and it splits `empty` from `ghost` — one says the
  answer is legitimately nothing, the other says point it somewhere.
- **`unbound` must name its input, per part.** Decision 6c already owes
  `needs: WidgetInput["type"]` instead of the day-shaped literal. The ghost needs it at part
  granularity: a two-input widget shows the day's parts resolved and the tag's parts ghosted
  in the same sentence.
- **A value kind per part** — money, count, date, time, duration, city, text. `format.ts`
  already has `formatMoney` / `formatDate`; this is the same closed set ADR-037 open
  question 4 calls "how to serialize them", used for ghost glyphs as well as formatting.
- **`stale` needs no new resolver state** — it is `unbound` plus the label of what was lost,
  which the resolver knows when a `DayRef` fails to resolve.

**One decision is owed and it is not the design's to take: ghosts are editing-only.** In
reading mode a widget with an unbound input prints nothing, and only someone with edit
rights sees a quiet "2 widgets aren't set up" line. The design's reason is that a reader is a
traveller and `$XXX` is worse than silence. It **refines** decision 6 rather than
contradicting it — the widget still renders in every state; in reading mode it renders as
nothing — but it changes what a resolver's output does downstream, so the build should
accept or reject it explicitly.

## 2f. Previously — the phone Notebook expresses the widget model

`SPEC.md` §19. The previous bundle listed the phone Notebook as one hardwired widget and an
open design pass; that pass is done, and the §8 item is removed.

Phone Notebook is now index → page, with the same widget instances, the same binds and the
same insert registry as desktop. **This adds no API surface.** Everything §2e asks for
already covers it — widget instances with stored bindings, input types picking a control,
`days` / `person` resolvers. What the client owes on top is layout only:

- Rebinding is a **sheet**, not an inline select row (390px cannot hold the desktop chrome
  row). One 44px "Pointed at …" button per widget opens it; it holds one control per declared
  input plus the same *Reads as* preview.
- Insert is one full-height sheet with two steps inside it — browse, then point it at.
  Not a sheet over a sheet (rule 3).
- The bind label joins multi-input widgets with ` → `.

The consequence for planning: **there is no longer a mobile-only Notebook slice to schedule.**
Notebook ships on both surfaces off the same resolvers, so M8's estimate should be one number,
not desktop-now / phone-later. The remaining phone Notebook question is content, not model.

## 3. Designed, shelled in code behind `<Preview>`

From the registry, unchanged this sync. **Blocked on a missing field:**
`rack-provenance` (who parked a stop, which day it came from), `cost-estimate-state`
(confirmed vs estimate), `budget-breakdown` (Booked/Holds/Travel/Other),
`trip-invites` (`TripMember.role` is the literal `"owner"`), `map-legend-modes`
(transport mode per leg).

**Blocked on a feature, not a field:** `home-worth-attention`, `home-decisions`,
`home-playbooks-strip`, `assistant-suggestions`, `assistant-quick-asks`,
`timeline-ghost`, `keep-day-flag`, `keep-day-dialog`, `playbooks-route`,
`insert-playbook`, `share-button`, `add-saved-day`.

Add to that list, from KI-47: **there is no `tags` field**, which blocks the tag chips
and dim-in-place filtering on five designed surfaces — including the phone's filter
chips.

## 4. Real in code, absent from design

- **Notebook / Pages — an entire feature.** `packages/pages` (macro registry,
  templates, inline + block macros), `NotebookScreen`, `PageScreen`, `PageEditor`
  (TipTap), `MacroNodeView`, `ComposePanel`, `ItineraryDayBlock`, `ItineraryTripBlock`,
  `CostsTableBlock`, routed at `/trips/[tripId]/pages`. **Still the item to settle first,
  but the question changed on 2026-09-02** (SPEC §18): the standoff was "design wants live
  macro chips, M8 removed macro authoring, `templates.ts` seeds no macro nodes". Under the
  widget model a seeded template is **a document holding widget instances with default
  bindings** — `day-sheet` seeds its widgets pointed at day index 0 — so nothing has to
  re-open macro *authoring*: the authoring surface is the insert sheet plus the in-place
  chrome row, neither of which is a text-macro editor. Settle it as "what does a seeded
  template instantiate", not "does macro authoring come back". It is still why the phone
  Notebook stays unstarted.
- **Trip lifecycle.** Delete → undo toast → `RestoreTrip`, and `duplicateTrip`. The
  optimistic pattern (drop the row on confirm, re-add on failure) has no design.
- **Dev login.** `dev-login` credentials provider behind `AUTH_DEV_LOGIN` — the only
  non-Google way in. Probably intentionally undesigned.

History & time travel came off this list on 2026-08-25 (designed). The "extra lenses"
bullet is struck permanently — `ItineraryLens`, `DailyOverviewLens` and
`FullTripOverviewLens` no longer exist.

## 5. Closed — kept as one line each

- **D5 / R6 rename.** No pencil, no ⚙, no inline rename on either surface; the trip
  title *is* the settings button and renaming happens only in Trip settings. Build
  still owes the `TripHeader.tsx` deletion and the two test updates.
- **D7 sync failure.** One banner pattern — reuses `ConflictBanner`'s vocabulary.
- **Rules pass (2026-08-25).** Header is account scope only; drawer renders only where
  things can be dragged; save state lives on the logo; filter row removed; undo/redo
  folded into History; Notebooks is a menu; Map keeps its day rail and hides the header
  chips.
- **Calendar (2026-08-26, SPEC §12).** Cells are city rollups, not activities; day
  selection is persistent and does not navigate; stop-level drag removed. Calendar's
  retirement question is answered — it is the city/shape view.
- **Two files became one.** `Trip Planner Mobile.dc.html` is deleted; the phone is a
  `surface` prop on the desktop file, sharing trips, accent hash, focus, tag filter and
  the edit sheet. Every mobile defect that pass fixed — stale October dates, blue
  Hakone, the leftover ⚙, a 25-vs-60-day countdown — was a copy drifting, not a design
  decision. Answers **KI-46** from the design side.
- **Seed data dated once.** Sep 20 – Oct 3, 2026, all 14 days with real weekdays.
  `japan-trip-seed.json` previously said Oct 3 – 16 — entirely inside October — so the
  preview's demo reset could never produce the two-month calendar SPEC §4 protects.
- **One handoff folder** (`design-sync/handoff/`); dated snapshots deleted.
- **DS findings moved out** to `design-sync/handoff/DS-UPSTREAM.md` (U1–U6). They belong
  to the design-system package, not this app.

## 6. Build-check list — things a build engineer should verify

Carried forward because each one is a bug the design already hit:

1. **Day labels derive month from start date + day index**, never from the trip start.
   Check `CalendarLens`, `MapRail`, every day chip.
2. **Accents are `oklch` and most non-CSS consumers cannot read them.** MapLibre parses
   CSS Color 3 only and silently falls back to black; canvas `fillStyle` and
   `getComputedStyle` both *preserve* `oklch()` verbatim, so they look like a fix and
   are not. Convert arithmetically wherever an accent reaches a map paint property, a
   chart library or an SVG attribute. Hue ramp has a 35° minimum gap.
3. **One `focus` per trip, but derivation is per surface.** The phone must not run the
   timeline's scroll-spy — a capture-phase `document` scroll listener will otherwise
   overwrite the phone's day selection from a still-mounted desktop timeline.
4. **The tab is the route.** The phone client must not hold tab state independent of
   the router; "am I in a trip" belongs to the route alone.
4b. **The phone tab bar's item list is derived from the route, not a constant.** Inside a
   trip: Plan · Map · Notebook. Outside: Trips · Playbooks. If the build renders a fixed
   five-item array, or adds a `disabled` prop to reach the same effect, it disagrees with
   the design (§2h, `SPEC.md` §22). Check the Notebook index keeps its `‹ Trips` link —
   without Trips in the bar, that link is the only exit from that screen.
5. **Maps inside conditional markup need a container-identity guard** — remount leaves
   the instance bound to a detached node and the style load aborts silently.
6. **Gesture handlers go on the element, not `document` with `capture: true`.**
7. **Saving a stop must actually move it** (keep duration, snap to 15 min, re-sort the
   day). This was a live desktop bug found only via the phone.

## 7. Their open items that touch design

| KI | Meaning for us |
|---|---|
| **KI-34** | = D6. Blocks the countdown and correct next-trip selection. |
| **KI-43** | `Board.tsx` stacks one full-width `Banner` per conflict — 12 on the Japan seed, board below the fold. Design puts conflicts inside the card, which `Column.tsx` already does. Design is right; the fix is theirs. |
| **KI-44** | `.tc-page-editor` is applied to every page and defined nowhere, so Notebook prose has no typography. Cheapest real fix in their audit. |
| **KI-45** | `Preview size="container"` covers host content, including a currency amount in Trip settings. |
| **KI-47** | No `tags` field. Blocks five designed surfaces. Don't design more tag UI until it lands. |
| **KI-48** | Six one-file cosmetics, including `1 travellers`. Our copy says "4 travelers". |

## 8. Still open, on our side

- **The billing surfaces are desktop and landing only.** No phone treatment for plan and
  usage or the collaboration gate; the operator console is deliberately never on the phone.
  The two phone states rule 6 wants for the plan section are undesigned.

- **The phone has no conflict state.** Offline / sync-fail landed (map tiles time out
  after 2.6s with *Try again* / *Open Plan*); conflict is still missing, and project
  rule 6 requires all three of every screen.
- **The landing page needs no empty / offline / conflict state.** Rule 6 is satisfied
  trivially: static fixture data, no session, no network — there is no state where it
  can fail to render. Noted so it is not re-raised.
- **Day 6's phone Plan cards** still carry times and an ordering that predate the seed,
  and one uses an estimate treatment for a stop the desktop has as `booked`. Content
  pass, not a token pass.
- **Whether a day column sorts by start time** the way the design does (their audit D3).
  Their `db-seed.ts` reverse-order bug is fixed and never reached the preview, but the
  product question is unanswered.

## Suggested order

1. Settle **D1** (rename to Caesura in code) — it is trivial and a year stale.
2. Settle **what a seeded template instantiates** (SPEC §18 vs `templates.ts`; was "§7 vs
   `templates.ts`"). It blocks Notebook on both surfaces *and* the landing page's second
   feature block. §18 narrows it to a data question — instances with default bindings —
   rather than a reversal of M8.
3. Land **KI-34** so the home hero can be honest.
4. Design the phone **conflict** state; that is the last of rule 6 — and now the only
   phone gap in Notebook's path, since §2f closed the other one.
5. Then §4's undesigned lifecycle work.

Build status, for planning: M10 Wave 2 Phases 5–8b are merged; **Phase 9 is M10's exit
gate and is the next work**. Nothing in this document holds it.
