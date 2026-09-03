# M14 — Rich layer

**Status:** Scoped 2026-09-01. Placed **after M13** in the order set the same day
(`M17 → M9 → M12 → M13 → M14 → M19`). It had no file and no exit gate until now
— a table row and nothing else.

**The navigation-and-index half was pulled forward and built 2026-09-03**, on
Mitchell's instruction, out of the order above and with M17's gate still open.
That is the decision this file said was "available to be taken"; it has now been
taken. What landed, and what it cost, is in *The navigation and index half*
below.

**The builder half is unblocked as of 2026-09-03.** Its prerequisite ADRs — 035
(the widget model) and 036 (notebook history) — were **accepted** that day, by
Mitchell's instruction to build against them. Links 2–8 are open for work.
**Link 9 is not**, despite 036 being accepted: acceptance left one question open
that a build cannot answer for itself, and the gate says which.

**It opens with an ADR** — and that ADR is a prerequisite, not a deliverable to
write mid-build. Routed here by the 2026-08-23 design sync, which also gave this
milestone the **whole Notebook redesign** (`SPEC.md` §7) — since replaced for the
builder half by §18.

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

## Scope — RESCOPED 2026-09-03 by SPEC §18

**§18 ("Notebook widgets — a page has no scope", 2026-09-02) replaced §7's model**, and it
reached `main` in `f365f0b` *after* the navigation half had already merged. The six links
below were written against §7. What follows supersedes them; the originals are kept beneath
so the change is legible rather than silent.

Mitchell's framing, 2026-09-03:

> we no longer care about the type of notebook, they arent a Trip notebook, or day, they
> are just a notebook, and text or widgets. Each widget has input params, and those input
> params can be configured in edit mode. […] **widgets are functions and inputs**.

### The links now

1. **ADR-035 accepted** — *A notebook page is text and widgets; a widget is a function of
   declared inputs*. Rewritten 2026-09-03 against §18; the earlier repeaters-only draft is
   superseded. **Accepted 2026-09-03**, together with ADR-036, on Mitchell's instruction to
   build the builder half against them. Links 2–8 are unblocked; **link 9 is not** — see the
   gate.
2. **A page loses its scope.** `PageContext.dayRef` removed, and with it the "This page is
   about" dropdown, the follows-a-day Banner, `handleBindDay`/`focusDayBinding`, **and the
   Trip-wide / Day 6 badge PR #126 shipped on the index**. A contract change, so invariant
   5's protocol. *This un-ships part of #126 and that is expected — it was built against §7
   a day after §18 replaced it.*
3. **The registry declares inputs.** Each entry gains `inputs: WidgetInput[]` over §18's
   five types (`day`, `days`, `person`, `tags`, `trip`). The type picks the control, so a
   new widget taking a day needs no new UI. `params` stays the validator.
4. **Binding lives on the widget instance** — in `MacroNode.attrs.params`, which the
   contract already has — and is **configured in Editing mode** via the chrome row (name
   pill + bind selects). Insert and rebind share one control set.
5. **The insert Sheet, two steps**: search + *how it reads* over a flat list, then
   **Point it at** for widgets with inputs. Widgets with no inputs insert immediately.
   *(Scope × shape is gone — §18 struck the account/trip/day scope rows.)*
6. **Repeaters**, built to ADR-035: a `repeat` node whose content is the author's row
   template; iteration items are render-time and never stored.
7. **Prebuilt templates instantiate widgets** with default bindings. §18 dissolves §7's
   `templates.ts` blocker — the question is no longer "does macro authoring come back" but
   "what does a seeded template instantiate".
8. **The assistant's page tools become insert-shaped** — `insert_text` and
   `insert_widget(name, params)`, derived from the registry rather than hand-maintained
   beside it, replacing `compose_page`'s whole-document round trip. `AskScope` already
   carries `{ kind: "page"; pageId }` and `/ask` already verifies the page (ADR-033), so
   this is a tool-list change, not new plumbing.
9. **Notebook history — ADR-036 accepted, then built.** *(Accepted 2026-09-03. **Blocked
   anyway**: acceptance left open where an unsettled draft lives once `pages` is a
   projection — 800ms autosave against once-per-session events means a rebuild mid-session
   destroys prose the log does not carry. That is a decision, not an implementation detail;
   it goes in the ADR before this link is briefed.)* Notebook content joins the event
   log, completing the parenthesis ADR-003 left open (*"and later, trip-page content"*).
   A page is its own stream so board-level ⌘Z cannot revert prose; autosave keeps its
   800ms cadence for durability while history commits **one event per settled edit
   session**. The `pages` table becomes a projection rather than the authority — that is
   the real work in this link.

### Rescoped a second time, 2026-09-03 (evening) — and it no longer fits in one milestone

The nine links above were written before the widget model was worked out. Mitchell's answers
that evening settled six questions and **grew the work well past what this milestone can
hold**. Recorded here as a proposal, because splitting a milestone is his call, not a build's.

What the answers added (all in `ADR-037`, `ADR-038` and
`docs/specs/2026-09-03-notebook-widget-catalogue.md`):

| | New work | Why it is not "a widget" |
|---|---|---|
| **A** | **A versioned document AST** (ADR-038) | `PageContent` is `z.array(z.unknown())` with no version marker, and the ordinary read→render→autosave path silently drops nodes an older schema does not know. Blocking, and it gets worse once ADR-036 puts documents in an append-only log |
| **B** | **The widget module contract** (ADR-037) | Deletes `MacroView`'s `switch (name)` so a widget can be added without editing a React component. This is the "easily add more" requirement |
| **C** | **`WidgetContext = { user, trip? }`** | A notebook is always account-scope, optionally trip-scope, trip fixed at creation. Contract + signature change; unblocks four account widgets |
| **D** | **A trip-globals projection** | `trip.cities` does not exist — cities are derived per-activity via `cityFor()`. Nothing can address collections until they are collections |
| **E** | **The attribute manifest**, from annotated Zod fields | "A developer adding an attribute gets a widget free". Opt-in, never opt-out |
| **F** | **An attribution model** — who a stop is for, who booked it, who owes what | **New domain concept**: fields, events, conflicts, a settle-up notion. The two person widgets cannot resolve anything without it |
| **G** | **The sidebar, drag-and-drop and the slash menu** | Supersedes §18's Sheet |
| **H** | **~14 more widgets**, six of which need `kind: "repeat"` first | |

**Recommendation: split, and F is the natural seam.**

- **M14 keeps A, B, C, D, E, G, H** — the notebook document, the widget framework, and every
  widget that needs no new domain data. That is still a large milestone and it delivers a
  working, extensible Notebook.
- **F becomes its own milestone.** Attributing stops and money to people is a *product
  feature* — expense splitting — that happens to have two widgets pointed at it. It carries
  events, a conflict surface and a settle-up model. Scoping it as a line item inside "build
  the widgets" is how a milestone silently doubles.
- **Link 9 (notebook history, ADR-036) should move behind ADR-038.** It stores documents; if
  documents are versioned, the log holds a version per event and replay migrates each. If not,
  it writes unversioned documents into the one place a format mistake is permanent. It is
  already blocked on the unsettled draft-durability question, so this costs nothing.

**Sequence, if the split is taken:** ADR-038 (format) → B (module contract) → C (context) →
D (projection) → E (manifest) → G (insert surface) + link 4's chrome row → H (widgets) →
link 7 (templates) → link 8 (assistant tools). F and link 9 leave this milestone.

### What this does to the gate

The old gate's **"choosing a day value on a trip-wide page binds the page and reveals the
dropdown"** box is **void** — there is no page binding to reveal. Replaced by: *a widget's
inputs are bound at insert and rebindable from the chrome row, and two widgets on one page
can read two different days.*

**Carried into the gate itself on 2026-09-03**, which this section had not done: saying a
box is void here and leaving it ticked-shaped down there is how a struck requirement gets
built by the next session that reads only the checklist. The picker box is rewritten to
§18's two-step Sheet (keeping the `needs a field` badge, the one rule §7's picker subsection
survived by), and the two-widgets-two-days replacement is now its own box.

---

## Scope (as written against §7, superseded above — kept for the record)

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
  >    updated. Additive and small — but the claim was that there was none.

  Of the gallery's three, the first two are link 6's existing `templates.ts`
  seeds; the third is `handleCreate` as it already behaves. The button's noun
  also disagrees with §11's rule: the design says *notebook* in all three places
  and the build says *page*.

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
- **A known issue was filed with the code and then resolved the same day, and
  the entry's reasoning was the part that was wrong.**
  `KI-20260903` claimed the provenance line could not tell the reader's own
  notebook from a collaborator's without a `users` join. Review pointed out the
  list route already resolves the reader from its own `guard(tripId, "viewer")`
  call — `g.userId` was there the whole time. The GET now returns `viewerId`,
  and the line distinguishes seeded / yours / **"From another traveler"**
  without ever naming the other person, which is the only part that would have
  needed the join. Entry moved to `resolved/` with the correction.
- **Two more defects came out of the same review, both real.** The list route
  was sending every notebook's full `content` and letting `PageSummary.parse`
  strip it in the browser — on a list the menu re-reads on every open — so
  `listPages` now projects a real summary and its long-standing return type
  stops being a lie. And the menu offered "New notebook" to a **viewer**, whose
  POST the route refuses: withheld now, per ADR-031's rule that a disabled
  control still says "there is something here for you".

**Verified 2026-09-03** at `3aeb041`: `pnpm typecheck` (8 packages), `pnpm lint`
plus all four walls, **2,865 unit tests**, **443 integration**, and
**`pnpm --filter web test:e2e:ci-like` at 80 passed** — the ci-like lane, not
`test:e2e` (CLAUDE.md rule 1). Every new test was watched failing under a
deliberate mutation of the code it protects before being kept (23 across three
rounds; PR #126's description lists every one with its real failure text,
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

**The preview walk happened too, on the deployed artifact** (deployment
`dpl_Ahfakrd…`, built from `a4bfbc2` — the commit carrying the ordering fix),
signed in as a dev user. It confirms the fix where it matters: creating from the
Day Sheet template left the list reading *Trip Overview (seeded) → Day Sheet
(seeded) → Day Sheet (Yours)*, with the new notebook **appended last**, which is
where the client had put it optimistically.

Two things about getting there are worth keeping, because both cost a run:

- **`VERCEL_AUTOMATION_BYPASS_SECRET` was the whole unlock**, exactly as
  `cloud-agent-sessions.md` predicted. Three `?_vercel_share=` links had all
  redeemed as `429 Vercel Security Checkpoint` first. The secret must be in the
  **session's own environment**; setting it in the Vercel project does not reach
  a container whose environment was fixed at start.
- **No invite code was needed.** `admission.ts` evaluates admission only for
  someone with **no `users` row**, so an existing dev user is admitted as
  `returning-user`. `INVITE_SUPER_CODE` is a first-sign-in concern, and
  `playwright.config.ts` injects it only into the local e2e server — which had
  been read here as "the preview is unreachable" and is not what it means.

**Still owed by this half:** §7's
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

- [x] **The repeaters ADR is written and accepted before any repeater code
      lands**, and it names what a row template is, how it is stored, and what
      an empty collection renders.
      *(**Accepted 2026-09-03** — `ADR-035-widgets-are-functions-of-declared-inputs.md`,
      which is the rewrite of the file this box was written against
      (`ADR-035-repeaters-are-document-content-not-macro-params.md`); repeaters
      turned out to be one shape of one kind of widget, so the ADR grew to the
      model underneath them. It still answers all three of this box's questions,
      in decision 4: a row template is the `repeat` node's own inline content in
      the page document (not a string and not a `params` value, both of which
      reintroduce the macro syntax §7 forbids); the item scope is a render-time
      argument and never persisted, so nothing stores an item identity a moved
      day could stale; and an empty collection renders `emptyText` in Reading but
      keeps the rail and the row template in Editing, because the empty case is
      exactly when an author is writing. Acceptance was Mitchell's instruction to
      build the builder half against it, not the file existing.)*
- [x] **ADR-036 accepted** — notebook history is event-sourced per page, at
      edit-session granularity.
      *(**Accepted 2026-09-03**, same instruction. Acceptance did **not** settle
      where an unsettled draft lives once `pages` is a projection: autosave writes
      the row every 800ms while history commits once per settled session, so
      between the two a rebuild would destroy prose no event carries. Recorded as
      the last bullet under that ADR's Consequences. **Link 9 does not start until
      that has an answer** — it is contract-and-migration shaped and belongs in the
      ADR, not in a reducer discovered halfway through.)*
- [ ] A page reads as prose with live chips, and **moving a day or a stop
      changes the page with nobody editing it** — walked, not asserted.
- [ ] **No user-visible macro syntax anywhere**, in either mode. A test fails if
      raw syntax reaches the DOM.
- [ ] Reading and Editing are one control; Reading shows no insert affordance and
      no repeat-rail chrome.
- [ ] The insert Sheet offers search + *how it reads* over a flat list, each row
      carrying its shape tag, a **real resolved preview**, and a mono line naming
      what it takes; then **Point it at** for widgets with inputs, and immediate
      insert for those without. A value with no field behind it still carries the
      **`needs a field` badge** and says so on click instead of claiming an insert
      — the one rule §7's picker subsection kept when §18 replaced the rest of it.
      *(Rewritten 2026-09-03. The original box ended "…and choosing a day value on
      a trip-wide page **binds the page and reveals the dropdown**", which §18
      voided outright: there is no page binding left to reveal. The rescope section
      above said the box was void and then left it standing in the gate, which is
      how a struck requirement gets built by the next session that reads only the
      checklist.)*
- [ ] **Two widgets on one page read two different days**, bound at insert and
      rebindable from the chrome row — the replacement the rescope section named
      for the voided box above, and the one check that actually proves the model.
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
