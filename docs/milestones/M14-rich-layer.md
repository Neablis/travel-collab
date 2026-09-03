# M14 — Rich layer

**Status:** Scoped 2026-09-01. Placed **after M13** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until now
— a table row and nothing else.

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
  **scope badge** (`Trip-wide` / `Day 6` — `scopeLabel` already computes the
  string at `NotebookScreen.tsx:19` and nothing renders it), a one-line
  description, a **provenance and freshness line** (*"Comes with your trip ·
  edited 2 days ago"* versus *"Yours · edited 4 hours ago"*), and a
  **"Start from a template"** gallery of three — *Trip overview*, *One day*,
  *Blank page*. The first two are link 6's existing `templates.ts` seeds; the
  third is `handleCreate` as it already behaves. The button's noun also
  disagrees with §11's rule: the design says *notebook* in all three places and
  the build says *page*.

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
