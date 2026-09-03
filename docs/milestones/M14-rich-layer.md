# M14 — Rich layer

**Status:** Scoped 2026-09-01. Placed **after M13** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until now
— a table row and nothing else.

**The navigation-and-index half was pulled forward and built 2026-09-03**, on
Mitchell's instruction, out of the order above and with M17's gate still open.
That is the decision this file said was "available to be taken"; it has now been
taken. What landed, and what it cost, is in *The navigation and index half*
below. **The blocked half has not moved** — but its prerequisite now exists as a
written proposal: `ADR-035-repeaters-are-document-content-not-macro-params.md`,
**PROPOSED, awaiting Mitchell's acceptance**. Links 4 and 5 stay gated until it
is accepted.

**It opens with an ADR — repeaters** — and that ADR is a prerequisite, not a
deliverable to write mid-build. Routed here by the 2026-08-23 design sync, which
also gave this milestone the **whole Notebook redesign** (`SPEC.md` §7).

## Why this exists

M7 shipped the Notebook as a substrate and M8 pulled it back to plain notes. The
2026-08-23 design sync then specified what it should actually be, and routed the
whole of §7 here. Three things are true in `main` today:

1. **The pages substrate is real and the design is not built on it.**
   `packages/pages` has a macro registry with per-macro `params`
   (`registry-types.ts:17` — `params: z.ZodType<P>`), `inline` and `block`
   macros, `PageContext.dayRef`, and the two seeds §7 names (`trip-overview`,
   `day-sheet` in `templates.ts`). The routes exist. What does not exist is the
   document §7 describes.
2. **There is no Reading/Editing mode.** §7 makes it one segmented control, with
   Editing revealing the repeat rail's label, its "Edit the wording" action and
   the insert affordance, and Reading being the traveller's view. `PageScreen`
   has no mode at all.
3. **The registry cannot express a repeater, and that is the one genuinely new
   engineering decision.** §7 says so directly: *"`itinerary.trip` resolves a
   fixed block; there is no loop macro and no params for an author-supplied row
   template."* Checked against the tree: `MacroKind` is `"inline" | "block"` —
   there is no repeat kind — and **every macro in `macros/` is `NoParams`**, 18
   occurrences across the two files. The `params` seam exists and has never been
   used.

That last point is why this milestone is late in the order and opens with an
ADR. Everything else here is building a designed document on a substrate that
already works; repeaters change the substrate.

## Scope

Six links. Link 1 is an ADR and gates links 4 and 5.

1. **The repeaters ADR.** A loop macro with an author-supplied row template:
   what a row template *is* (a string with chip slots? a nested macro list?),
   how it is stored in a page's content, how it resolves per item, and what it
   does when the collection is empty. **The registry already owns per-macro
   `params` and no macro has ever used it** — this ADR is what that seam was
   bought for. Decide it before building; a repeater retrofitted afterwards is
   a second mechanism.
2. **Reading / Editing as one segmented control.** Reading is the traveller's
   view; Editing reveals the insert affordance, the repeat rail's label and
   "Edit the wording". §7 treats these as one control with two states, not two
   routes.
3. **Values render as chips.** Tinted, faintly underlined, macro name in the
   `title`, reading as words in a sentence and resolving from the trip on every
   render — *"so moving a day or a stop rewrites the page with nobody editing
   it."* **Users never see or type macro syntax**; that is the rule the whole
   section rests on.
4. **The insert picker — scope × shape, not one list.** A Sheet with search,
   then scope (Your account / This trip / The day this page is about, each with
   a live count and a one-line explanation), then how it reads (All / One value
   / A block / Repeats). Two states it must keep honest, both named in §7:
   - a value with **no field behind it** carries a `needs a field` badge and
     says so on click instead of claiming an insert;
   - choosing a **day** value on a **trip-wide** page **binds the page to a
     day** and reveals the dropdown — `MacroResult`'s `unbound("day")` case,
     matching the existing `PageScreen.handleBindDay` / `focusDayBinding`.
5. **Repeaters, built to the ADR.** One author-written sentence repeated per
   day/stop/city, chips filled from each item, on a dashed rail labelled with
   what it repeats over.
6. **Prebuilt pages ship with the trip.** "Trip overview" (trip-wide) and "One
   day" (day-bound), matching the existing `templates.ts` seeds, plus the user's
   own pages. "Blank page" creates an **Untitled page** that does not appear in
   the list until it exists — matching `NotebookScreen`'s `handleCreate`.

**§7's Notebook has two halves, and only one of them is blocked
(noted 2026-09-02).** The milestone reads as one indivisible thing because the
repeaters ADR gates links 4 and 5, and `DRIFT.md` §4 says of §7 *"nobody should
design or build to §7 until that is settled"*. That sentence is about **macro
authoring in prose** — the M8 subtraction versus what §7 asks for — and it has
been read as covering the whole feature. It does not cover the half below.

**The navigation and index half is designed, unbuilt, and blocked by nothing.**
It needs no ADR, no contract change, no macro decision and no new field:

- **The Notebooks menu** (`SPEC.md` §11, the 2026-08-25 rules pass): a bordered
  pill — notebook icon, "Notebooks", ▾ — at the **far right of the view row**,
  deliberately a different class of thing from the lens tabs, opening *New
  notebook*, then the trip's notebooks with their day / trip-wide binding, then
  *Browse all notebooks →*. One noun in all three places. §11 also pins the
  popover height rules and warns off arbitrary Tailwind values.
  **The build has a plain text `<Link>` labelled "Notebook"** in
  `TripHeader.tsx:137`, going straight to `/trips/[tripId]/pages`. **No link in
  this milestone owns the menu**, and `DRIFT.md` §5 lists the rules pass as
  closed without recording that this part of it was never built — unlike the
  D5/R6 line beside it, which does say what the build still owes.
- **The Notebook index page.** `NotebookScreen.tsx` renders a bare
  `Heading level={2}` "Notebook", a **`+ New page`** button and a flat list of
  cards with inline rename and delete. The design has, and the build has none
  of: the standfirst (*"Pages that read like a document and stay true to the
  plan. Move a day or a stop and every page here follows it"*), a per-page
  **scope badge** (`Trip-wide` / `Day 6`), a one-line
  description, a **provenance and freshness line** (*"Comes with your trip ·
  edited 2 days ago"* versus *"Yours · edited 4 hours ago"*), and a
  **"Start from a template"** gallery of three — *Trip overview*, *One day*,
  *Blank page*.

  > **Two claims in the paragraph above were wrong about the code, corrected
  > 2026-09-03 while building it.** They are left visible rather than quietly
  > edited, because both were repeated verbatim into `TODO.md` and read as fact
  > by the session that acted on them.
  >
  > 1. *"`scopeLabel` already computes the string and nothing renders it"* — the
  >    function was called `describeBinding` (`NotebookScreen.tsx:18`) and it
  >    **was** rendered, at `:167`, as the first half of a
  >    `"Trip-wide · Updated <locale string>"` line. The design ask survives
  >    intact: it wants a scannable badge and the build had secondary text. But
  >    "nothing renders it" described a hole that was not there.
  > 2. *"needs no ADR, no contract change and no macro decision"* — **it needed
  >    a contract change.** The provenance line distinguishes a seeded notebook
  >    from an authored one, and the only fact that separates them is the row's
  >    `actorId`, which `PageSummary` did not carry. That is `packages/contracts`,
  >    so it took invariant 5's protocol: a changelog entry and every consumer
  >    updated. Additive and small — but the claim was that there was none. The first two are link 6's existing `templates.ts` seeds; the
  third is `handleCreate` as it already behaves. The button's noun also
  disagrees with §11's rule: the design says *notebook* in all three places and
  the build says *page*.

### What the navigation and index half actually shipped (2026-09-03)

Both surfaces, plus one contract change and one recorded limit.

- **The Notebooks menu** — `apps/web/src/components/trip/NotebooksMenu.tsx`, a
  bordered pill in the view row (`TripBoardScreen`), at the far right via
  `ml-auto` rather than `justify-between`, because the tag focus line appears
  and disappears between the tabs and the pill and would otherwise drag it
  leftwards. It opens *New notebook*, the trip's notebooks with their binding,
  and *Browse all notebooks →*, with §11's inline `max-height` and pinned
  create/footer rows. The plain `<Link>` at `TripHeader.tsx:137` is **deleted**;
  it is gated on `isDemoTripId` exactly as that nav row was (ADR-031).
- **The index** — standfirst verbatim from §7, the scope as a `Badge`,
  provenance and relative freshness, and the "Start from a template" trio over
  `templates.ts`'s existing seeds plus a blank. The list gained a titled
  region (`Your notebooks`), which was not cosmetic: a template card and a
  notebook seeded *from* that template share a name by design, so the page had
  two peer lists and no way — for a screen reader or a test — to say which was
  which.
- **`formatRelativeInstant`** (`lib/formatDate.ts`), for the freshness line.
  It **clamps the future to "just now"** rather than taking an absolute
  elapsed time: a symmetric `Math.abs` renders a clock-skewed row as
  "2 hours ago", inventing a past as false as the future it avoided. The first
  version of this had a dead guard and would have rendered "edited in 2 hours";
  the mutation run is what found it.
- **Two nouns were decided rather than inherited.** §11's "one noun in all three
  places" wins over §7's literal strings wherever they disagree, so the gallery's
  third card is *Blank notebook* and it creates an *Untitled notebook*, where §7
  writes "Blank page" and this file's link 6 quotes the build's "Untitled page".
  The two template cards take their names from the **seeds** (`Trip Overview`,
  `Day Sheet`) rather than §7's *Trip overview* / *One day*, so that what you
  click and what you get agree, and so a trip seeded before today does not list
  a notebook under a gallery card with a different name. **Renaming the seeds is
  link 6's file to touch**, and is still open.
- **One known issue filed with the code, not after it:**
  `KI-20260903-notebook-provenance-says-yours-for-a-collaborator.md`. The
  seeded half of the provenance line is exact; the authored half says "Yours"
  for anyone, because naming an author needs a `users` join `pages` has never
  had — the same gap `displayName.ts` records for saved days.

**Verified 2026-09-03** at `3aeb041`: `pnpm typecheck` (8 packages), `pnpm lint`
plus all four walls, **2,865 unit tests**, **443 integration**, and
**`pnpm --filter web test:e2e:ci-like` at 80 passed** — the ci-like lane, not
`test:e2e` (CLAUDE.md rule 1). Every new test was watched failing under a
deliberate mutation of the code it protects before being kept (13 mutations,
rule 3); one of those mutations found a real defect in `formatRelativeInstant`
rather than confirming a test, which is recorded above.

**The browser walk happened on 2026-09-03, against a local production build,
and it found a defect three test layers had missed.** `listPages` was a bare
`SELECT … WHERE` with no `ORDER BY`, so Postgres returned notebooks in physical
row order — which an `UPDATE` changes, because it writes a new row version. A
notebook created through the index came back **first** on the next read while
`handleCreate` had just appended it **last** to its own list. Fixed with
`ORDER BY created_at, id`, plus a per-seed millisecond stagger, because
`instantiateDefaults` gave every seeded row one shared `now` and a tied sort key
falls back to the same luck. Both halves are covered by one integration test,
and the tie half is worth the anecdote: with the stagger reverted that test
**passed once and failed twice in three identical runs**.

Why no test caught it: unit and e2e both seed their rows in a single insert and
never observe a reshuffle, so every layer agreed with itself. It took looking at
the screen.

**The Vercel preview walk is still blocked, and it is a known condition rather
than a new one.** `docs/guidelines/cloud-agent-sessions.md` (2026-08-30) already
records `?_vercel_share=` links redeeming as `429 Vercel Security Checkpoint`
from this container — Vercel's anti-bot interstitial challenging headless
Chromium on a datacentre IP — and concludes that
`VERCEL_AUTOMATION_BYPASS_SECRET` is the only dependable route. Reproduced
exactly here across three freshly minted links. The secret must be in the
**session's own environment** to be usable, and a cloud session's environment is
fixed when its container starts, so setting it in the Vercel project does not
reach a session already running.

**Still owed by this half:** the walk against the deployed preview specifically
(the local walk exercises the same code but not the same artifact), and §7's
"one-line description" per notebook is **not built** — the index shows title,
scope, provenance and freshness, and there is no description field on a page to
show. That is a field, so it is a contract change of its own and was left rather
than invented.

**What this means for placement.** The blocked half is genuinely late-order
work — it opens with an ADR and changes the substrate. The unblocked half is
presentation over data that already exists, and it is the half a person
actually sees. Splitting them is not proposed here, because the order is
Mitchell's; what is recorded is that **the two are separable**, so that pulling
the navigation and index forward is a decision that can be taken rather than
one the milestone's shape hides.

**Two items routed here by earlier decisions, and both need a call before this
milestone opens:**

- **The macro vocabulary deferred out of M8.** Recorded in `TODO.md` since
  2026-08-07. Some of it may be subsumed by links 4-5; what is not should be
  named explicitly rather than carried as a phrase.
- **External calendar sync.** On this milestone's row since 2026-07-07 (*"the
  original vision bundled internal calendar UX and external sync; they are
  different features"*). **It has no design, no ADR and no relationship to the
  Notebook**, and it is the one part of this milestone that is not §7. It is
  large enough to be its own milestone and should either be scoped here
  deliberately or split out — flagged 2026-09-01, not decided.

## Exit gate

- [ ] **The repeaters ADR is written and accepted before any repeater code
      lands**, and it names what a row template is, how it is stored, and what
      an empty collection renders.
      *(**Written 2026-09-03, not yet accepted** —
      `docs/architecture/ADR-035-repeaters-are-document-content-not-macro-params.md`,
      status PROPOSED. It answers all three: a row template is the `repeat`
      node's own inline content in the page document (not a string and not a
      `params` value, both of which reintroduce the macro syntax §7 forbids);
      the item scope is a render-time argument and never enters `PageContext`,
      so nothing stores an item identity that a moved day could stale; and an
      empty collection renders `emptyText` in Reading but keeps the rail and
      the row template in Editing, because the empty case is exactly when an
      author is writing. **This box ticks on Mitchell's acceptance, not on the
      file existing.**)*
- [ ] A page reads as prose with live chips, and **moving a day or a stop
      changes the page with nobody editing it** — walked, not asserted.
- [ ] **No user-visible macro syntax anywhere**, in either mode. A test fails if
      raw syntax reaches the DOM.
- [ ] Reading and Editing are one control; Reading shows no insert affordance and
      no repeat-rail chrome.
- [ ] The insert picker offers scope × shape with live counts, a **`needs a
      field` badge** on a value with no field behind it, and choosing a day value
      on a trip-wide page **binds the page and reveals the dropdown**.
- [ ] A repeater renders one line per day/stop/city with chips filled from each
      item, and renders its empty case the way the ADR says it should.
- [ ] Both prebuilt pages ship with a new trip and resolve against it.
- [ ] The full Definition of Done is green, including
      `pnpm --filter web test:e2e:ci-like` — not `test:e2e`.
- [ ] Retro appended at gate close.

## Deliberately not here

- **Embedded community objects.** The original 2026-07-07 scope said "Notion-style
  pages with embedded community objects". M11b and M12 own the community
  surfaces; embedding one *in a page* is a third thing and is not in §7. Not
  scoped here — name it as a candidate rather than discovering it mid-build.
- **A TipTap/Yjs adoption.** The roadmap table has said "TipTap/Yjs ADR due here"
  since 2026-07-07, from a time when this milestone was expected to bring
  collaborative rich text. **M13 now owns the realtime transport decision**, and
  §7's document is prose with resolved chips rather than a collaborative editor.
  Adopting an editor framework is a separate decision that this milestone should
  make explicitly if it makes it at all.
- **Account-scope values.** §7 notes account scope is new and *"anything else at
  that scope needs fields first"*. **M17 supplies those fields** — name and home
  airport — so the picker's account scope shows what M17 landed and nothing
  more.

## Prerequisites

**M17, for the account scope in link 4's picker.** Closed before this milestone
in the current order; if M17 slips past it, the account scope row shows only
what the session already carries (name, email) and says so.

**M13, for nothing structural** — it is placed after M13 because M13 is the
larger architectural lift and this milestone is long. Nothing in §7 reads a
realtime transport.

**A decision on external calendar sync** — see the second bullet under Scope.
