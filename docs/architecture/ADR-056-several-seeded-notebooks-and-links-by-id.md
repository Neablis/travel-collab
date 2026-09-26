# ADR-056: A trip is seeded with several notebooks, and a link names its target by id

**Status:** **Accepted — 2026-09-26, Mitchell's decisions in chat; the details below are
the coordinator's, pending his review** (listed at the end).
**Deciders:** Mitchell (product/eng); Claude — drafted
Related: **ADR-037** (a widget is a module; decision 3a closes `Seg`), **ADR-038** (a page
is a versioned AST), **ADR-039** (presets are never stored), **ADR-052** (outside data is a
pre-fetched slot), **ADR-054** (three kinds), SPEC §25 (the undeletable Overview).
Milestone: `docs/milestones/M30-notebooks-and-links.md`.

## Context

Mitchell, 2026-09-26, after the §36.10b Overview rewrite:

> *"I am still not happy with the Overview page. It reads like a massive dump of
> information. I know its a lot of stops, but i guess i wanted it to read more like a
> Professional travel itinerary. Maybe the issues is trying to make the overview do
> everything, and instead we have several notebooks, with different purposes. A great
> feature we are missing is we should have a Link widget that lets you link to other
> notebooks, or pages in the website, maybe with a simple preview of the website rather
> than just rendering a html link"*.

Asked, he chose: **seed several notebooks into every new trip**; the Overview is
**"Letter + full daily schedule"**; and **two separate link widgets** — an internal one
that is *"more of a smart search bar that knows what is available and autocompletes, and
has simple previews"*, and an external one that is *"just a href shorthand"*.

The first reverses his own 2026-09-12 rule, *"Only 1 notebook per trip is always
generated, this is undeletable notebook that needs to be created on every new trip"*,
which the templates, their tests and three e2e walks all pinned.

## Decision

1. **Four notebooks are seeded: Overview, Before you go, Bookings, Money.** Each has one
   job (M30's file lists their contents). Only the Overview carries `kind: "overview"`,
   so only it is undeletable — `decidePageCommand` refuses on the marker, never on a
   title. The other three are also in the gallery, first, which is how a deleted one
   comes back. **Nothing migrates:** `listPages` seeds only a trip with zero pages.
2. **A link stores ids, never a URL.** `LinkTarget` is `{notebook, pageId}`,
   `{day, DayRef}` or `{view: Plan|Calendar|Map}` (`@tc/pages`' `linkTarget.ts`). `apps/web`
   turns it into an href at render time (`linkHref`) — the one place the app's routes
   meet a stored page. Renaming a notebook changes nothing stored; a deleted notebook
   renders *"this notebook was deleted"*; a removed day renders *"that day was removed"*,
   the answer every day filter already gives.
3. **The seeded Overview's links are built against minted ids.** `instantiateDefaults`
   takes the caller's `mintId` (this package has no randomness, Invariant 4), mints every
   seed's id first, and builds the Overview's document against them (`buildContent`).
   The server passes `randomUUID`; the demo passes its fixed `…e00n` ids. A racing second
   seeder loses every row, not some — one statement, rows in one order — so a winner's
   Overview never points at a loser's sibling.
4. **The notebook list is an `ExternalInputs` slot** — `notebooks: Slot<NotebookIndex>` —
   though it is our own data. It has exactly a slot's lifecycle (asked for only when a
   widget names it, `pending` until it lands, `failed` if not), and every piece of that
   already existed for weather: the loading chip, the first-paint allowance in
   `templates.ts`, `NO_EXTERNAL` on the server. It reuses `tripKeys.pages`, the key the
   Overview tab and the index already read, so a page with links usually costs nothing.
5. **The list carries what each notebook says.** `PageListEntry = PageSummary +
   preview {firstLine, widgetCount}`, computed from the stored document by
   `notebookPreviewOf`. A new type rather than a field on `PageSummary`, because
   `PageSummary` is also the public API's item and its route returns items as handed.
6. **Links are not offered to the assistant.** `MacroDef.composable: false`;
   `insert_widget`'s name enum is `COMPOSABLE_MACRO_NAMES` and the catalogue its prompt
   carries is filtered the same way. A link is an address somebody chose, and the text
   the assistant reads — a stop's notes, a page — is where one it should not plant
   would come from.
7. **An external link is its own `Rendered` kind, `{link, href, text}`.** ADR-037 3a
   closes `Seg` so a widget has nowhere to put an address; that stays true. The href is
   checked by the params schema (`WebAddress`: http/https via `new URL`), so a stored
   `javascript:` fails to parse and renders *"this widget's settings no longer fit it"*,
   and `insertWidget` and the page write check refuse it too. `MacroView` draws it as
   `<a target="_blank" rel="noopener noreferrer">`. **No server-side fetch, no preview.**
8. **Who may follow a link.** A card whose target the reader cannot open draws its name
   without the link: `NotebookIndex.openable` is false for the demo's visitor and an
   invitee having a look, whom the board already withholds the Notebooks menu from. Tab
   and day links stay on the board's own path (`/demo`, the invite look), so they work
   for both. In Editing no card navigates — a click selects the widget.

## Consequences

- **Every new trip opens with four notebooks**, and the seeded-template test holds all
  four to the empty-trip rule, at first paint and after load, on a dateless trip and on
  dated days with no stops. The composition is pinned per notebook.
- **A contract addition** (`NotebookPreview`, `PageListEntry`) — additive, `preview`
  optional so a client can read a server deployed before it.
- **`day.detail` gains `view: "schedule"`**, the printed itinerary, as a new block
  payload (`itinerary-schedule`). Stored `day.detail` widgets are untouched: absent is
  the glance they always drew. No page-document migration.
- **A first-party input now shares weather's slot machinery.** If a third first-party
  input appears, that is the point to ask whether `ExternalInputs` wants splitting.

## Alternatives rejected

- **Link by title or by a pasted URL.** Both break on a rename, and a pasted URL can
  point off the trip without anyone meaning it to.
- **A `seed` key on `PageContext`** so the Overview could link "the Money seed" without
  ids. A second marker beside `kind`, a contract change, and it would still need
  resolving to an id at render time.
- **Fetching each linked notebook's document for its preview.** N requests per page for
  one line each; the list already has to be read.
- **A website preview (title, image) for external links.** It means the server fetching
  an address somebody typed, on the reader's behalf, to anywhere — a different feature
  with its own risks. Mitchell scoped the external link to a shorthand.

## Review points for Mitchell

1. **What left the Overview.** *What needs you* and *Still to book* went to Bookings; the
   clocks, weather and country facts to Before you go; the spend chart to Money. The trip
   strip and the countdown are not seeded anywhere now.
2. **"Planned" says nothing on the schedule.** Only *To book* (pending) and *Travel* are
   labelled — since M28 planned is the default, and "Confirmed" on every line would be a
   claim the data does not make.
3. **Playbooks is not a link target** yet: its routes need a signed-in reader, and the
   task left it optional.
4. **The Overview's cards are the siblings as seeded.** A notebook the reader makes
   later is not added to them; they add a card like any other widget.
