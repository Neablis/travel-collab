# ADR-036: Notebook history is event-sourced per page, at edit-session granularity

**Status:** **PROPOSED — 2026-09-03.** Not accepted.
**Deciders:** Mitchell (product/eng) — pending; Claude (architect) — drafted
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

### 3. Two clocks: autosave for durability, history for meaning

These are deliberately different cadences and conflating them is the mistake this decision
exists to prevent.

| | Cadence | Purpose |
|---|---|---|
| **Autosave** (`updatePage`) | 800ms debounce, unchanged | Nothing is ever lost |
| **History event** | one per settled edit session | The timeline stays readable |

Durability does not wait for the session to end, so a crash mid-sentence loses nothing.
History does not fire per save, so a paragraph does not become forty entries.

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
- **an idle period materially longer than the autosave debounce.** A concrete floor
  rather than a feeling: it must be long enough that a pause for thought inside one
  paragraph does not split the session, which 800ms plainly is not.

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

## Alternatives rejected

- **A peer history/audit table for pages.** ADR-003's Option B, rejected there for the
  dual-write problem; nothing about documents weakens that argument.
- **Sharing the trip's stream.** Cheaper by one decision, and it makes board-level ⌘Z able
  to revert prose the presser cannot see. See decision 2.
- **An event per autosave.** Correct and useless: a readable history is the point, and
  this produces one entry per 800ms of typing.
- **Keeping pages on CRUD and adding a `page_versions` table.** This is the "add
  versioning later" retrofit ADR-003 names as a trap, and it would leave two answers to
  "what is the content of this page".
