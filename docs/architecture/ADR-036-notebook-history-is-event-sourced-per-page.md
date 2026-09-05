# ADR-036: Notebook history is event-sourced per page, at edit-session granularity

**Status:** **Accepted — 2026-09-03**: kicking off M14's builder half against this model is
the acceptance. The one thing acceptance left open — where an unsettled draft lives once
`pages` is a projection — was **settled by Mitchell the same day: there is only one clock.**
Autosave is dropped rather than reconciled; see decision 3. **Link 9 is unblocked.**
**Deciders:** Mitchell (product/eng); Claude (architect) — drafted
Related: **ADR-003** (what the event log covers — this completes a space it reserved),
ADR-035 (the widget model this stores), ADR-013/M2 (the history UI vocabulary),
M13 (realtime transport, which may revisit decision 4)

## Context

Mitchell, 2026-09-03:

> lets also make sure the notebook has the same history logic (though history only
> writes and steps through when you stop editing)

Two facts make this smaller than it sounds, and one makes it sharper.

**ADR-003 already reserved the space.** Its accepted Option C reads, verbatim:

> Trip Planning **(and later, trip-page content)** is event-sourced

That parenthesis was never cashed. Pages today are ordinary CRUD rows — `createPage`,
`updatePage`, `deletePage` against a `pages` table, with `PageScreen` autosaving on an
800ms debounce. So this is not a new architectural direction; it is the one ADR-003 named
and the build has not yet taken.

**The substrate is already stream-generic.** `events` carries a plain
`stream_id uuid` with a `(stream_id, seq)` unique index, and `readStream(q, streamId)`
reads any stream. Nothing about a second kind of stream needs a migration.

**The sharp part is granularity.** ADR-003 rejected snapshot-per-change *for planning*
because it "lacks operation-level granularity ('Alice moved the Colosseum to Tuesday')".
A document has no useful analogue below that line — "Alice typed `h`" is not history —
and Mitchell's constraint says as much: history writes *when you stop editing*.

## Decision

### 1. Notebook content joins the event log

Not a peer history module. ADR-003 rejected that option for the dual-write problem — one
code path that writes content without recording history and revert is silently broken
forever — and that argument applies to a document exactly as it applies to a trip.

### 2. A page is its own stream: `streamId = pageId`

Notebook events do **not** share the trip's stream.

The reason is undo. If a page's edits interleave into the trip's stream, ⌘Z on the board
walks "the newest not-yet-undone entry" and can silently revert somebody's prose — an
action the person pressing the key cannot see and did not mean. Per-page streams give a
page its own undo/redo over its own timeline, which is what a document editor should do,
and cost nothing: `stream_id` is already a bare uuid.

**The trip's history still shows notebook edits.** Display reads across the trip's pages;
only *undo* is stream-scoped. A reader of trip history should see "Mei edited *Hakone,
written out*" without that entry being undoable from the board.

### 3. One clock. The settled edit session is the only write

**REWRITTEN 2026-09-03. The first draft of this decision had two clocks — autosave every
800ms for durability, a history event per settled session for meaning — and they did not
compose with invariant 2.** A projection is rebuildable from the log; between the start of a
session and the event settling it, an 800ms-autosaved `pages` row holds content no event
carries, so `rebuildProjections()` destroys unsettled prose and the golden "rebuild equals
stored" test fails for any page mid-session.

Two ways out were on the table — a separate draft column keyed by editor, or a
`PageDraftSaved` event the projection folds and the history UI hides. Mitchell chose
neither:

> Can we punt on the 800ms autosaving as a future feature, and we save on edit finished to
> history. I understand that means its lost if we refresh or close browser while editing,
> but we can use local history or some other solution in future

**So autosave goes, and the gap closes by not existing.** There is one write, on the settled
edit session (decision 5), and the `pages` row is a pure projection with nothing in it that
the log does not carry. No draft column, no draft event, no second cadence to keep in step,
and invariant 2 holds without an argument.

**What this costs, stated plainly because it is a real regression and was accepted as one:**
prose typed since the session last settled is **lost on refresh, on a crash, and on closing
the tab**. Today's 800ms autosave loses at most 800ms of typing; after link 9 the exposure is
a whole editing session.

**The mitigation is named and deliberately deferred: browser-local drafts.** `localStorage`
keyed by page and editor, restored on mount and cleared when a session settles, buys back
crash and refresh durability without putting a second writer in front of the projection —
which is exactly why it can wait rather than being folded into this ADR. It is a client
concern, it needs no contract and no migration, and it does not change anything decided here.

**One tension this creates, and link 9 must pick a number for it.** With one clock, decision
5's idle threshold now carries durability as well as readability, and those pull opposite
ways: a short idle commits often (small loss window, noisy history — which is the failure
*"an event per autosave"* was rejected for), a long one keeps history readable and widens the
window. **Resolve it in favour of readable history** — that is what this ADR is for — and let
local drafts cover durability when they land.

### 4. One event per settled edit session, carrying the settled document

The event records the document as it stands when the session settles — a snapshot, not a
stream of ProseMirror steps.

**This is a scoped departure from ADR-003's snapshot rejection, and it is deliberate.**
That rejection was reasoned from what *planning* needs: operation-level granularity for
"meaningful concurrent-edit conflicts and readable history". For prose, the readable unit
*is* the session, and operation-level events mean ProseMirror steps with OT or a CRDT —
which is a realtime-collaboration decision, not a history one, and belongs to **M13**. If
M13 adopts a step-based transport, this decision is the thing it revisits; the ADR is
written so that revisiting it changes the event body and not the stream model.

### 5. "Stop editing" is defined, not implied

The session closes on whichever comes first:

- **leaving Editing mode** — §18 gives the page a Reading/Editing control, which is the
  most explicit signal available and should be the primary one;
- **the editor unmounting or the route changing** — navigating away is stopping;
- **an idle period long enough that a pause for thought inside one paragraph does not
  split the session.** A concrete floor rather than a feeling. It used to be phrased
  against the autosave debounce ("materially longer than 800ms"); with decision 3 rewritten
  there is no debounce to be longer than, and the number is now chosen against readability
  alone — see the tension noted there.

A session that closes with content identical to the last event writes **nothing** — the
common case of entering Editing mode, reading, and leaving must not manufacture an entry.

## Consequences

- **A contract and a migration.** Page events need types (`PageContentEdited`, and
  create/rename/delete as their own events) and pages need to stop being the source of
  truth for their own content. Its own reviewed PR with a changelog entry, per invariant
  5. Note this repo dispatches migrations by hand — `0014` and `0015` are outstanding
  against production at the time of writing.
- **The existing `pages` table becomes a projection**, rebuilt from the log like every
  other read model, rather than the authority. That is the part that is real work, and it
  is what makes revert trustworthy rather than best-effort.
- **The projection-rebuild golden test gains a page case**, which is the Definition of
  Done's own check for anything that touches events or reducers.
- **Undo/redo UI is reused, not rebuilt.** The History popover's vocabulary (undo walks to
  the newest not-yet-undone entry, marks it undone, toasts that entry's description) works
  unchanged against a page stream.
- **This is not concurrent editing.** Two people in one page at once is M13's problem;
  this decision gives a page a durable, readable, revertible timeline for one editor at a
  time and does not pretend to more.
- **SETTLED 2026-09-03, and link 9 is unblocked.** Decisions 3 and 4 did not compose with
  invariant 2 while autosave existed: `rebuildProjections()` enforces rebuildability the
  blunt way — it deletes and re-inserts
  (`apps/web/src/server/projections.int.test.ts:47`) — so an 800ms-autosaved row held
  content no event carried, and a rebuild mid-session destroyed unsettled prose. Decision 3
  is rewritten to one clock; the row now carries only what the log carries, and nothing
  further is owed here.
- **`PageScreen` loses its autosave in link 9, and the ADR-038 guard does not go with it.**
  The 800ms debounce and `lib/debounce.ts` are removed in favour of a commit on the settled
  session. That does **not** make decision 4's read-only guard moot: the loss vector is
  read → mount → write back a document the editor mangled, and changing *when* the write
  fires does not change *what* it writes. The guard sits upstream of mounting either way,
  and `toStoredPageDoc` becomes the parse in front of the history event instead of the
  parse in front of the autosave.

## Alternatives rejected

- **A peer history/audit table for pages.** ADR-003's Option B, rejected there for the
  dual-write problem; nothing about documents weakens that argument.
- **Sharing the trip's stream.** Cheaper by one decision, and it makes board-level ⌘Z able
  to revert prose the presser cannot see. See decision 2.
- **An event per autosave.** Correct and useless: a readable history is the point, and
  this produces one entry per 800ms of typing. Note this is also the failure mode a *short*
  idle threshold reintroduces now that one clock carries both jobs — see decision 3.
- **A draft column, or a `PageDraftSaved` event.** The two ways to keep autosave and satisfy
  invariant 2. Both were live options and both were dropped on 2026-09-03 in favour of
  removing the second clock: each buys back crash durability at the price of a second writer
  in front of the projection, contract-and-migration shaped, to solve a problem that
  `localStorage` on the client solves later with neither.
- **Keeping pages on CRUD and adding a `page_versions` table.** This is the "add
  versioning later" retrofit ADR-003 names as a trap, and it would leave two answers to
  "what is the content of this page".
