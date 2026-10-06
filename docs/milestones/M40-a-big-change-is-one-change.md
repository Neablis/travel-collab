# M40 — A big change is reviewed whole, taken whole, and undone whole

**Status:** **Proposed 2026-10-06, placed after M39. Not scoped yet**: the decisions below are
recommendations and none has been answered. Minted from `docs/candidates.md` (see
`docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

## Why this exists

Three of Mitchell's asks are about the same problem: a large change should be easy to review,
easy to accept in one step, and easy to undo in one step.

- **Accepting.** #314's *Accept all* accepts each change through the single-accept route, so ten
  changes become ten History rows and ten undos. 2026-10-04: *"'Accept all' should be one history
  change, not N different ones, we can use the bulk change history feature"*.
- **Reviewing.** 2026-10-03: *"if I ask it to add a day, have it add a day and fill it with
  proposed changes, then we can accept or deny them after seeing them in the trip"*. The
  assistant's proposals would become stored suggestions on the board, instead of ADR-022's
  client-side, ephemeral proposals.
- **Getting back.** 2026-10-05: *"Named Snapshots in history … 'save' the current trip … and jump
  back to that point without having to scroll through a ton of history"*.

The snapshots entry names the pairing directly: saving a snapshot before the assistant's large
proposal is the likeliest first use. The order inside the milestone follows from that. Batch
accept comes first, because it is small and self-contained. Snapshots come next, and assistant
suggestions last, since they use both.

Candidates absorbed (each deleted by this gate):
- *"Accept all" lands as one History entry, not one per change* (2026-10-04)
- *Named snapshots in History* (2026-10-05)
- *The assistant proposes through suggestions, so a big change is reviewed on the board*
  (2026-10-03)

## Decisions it needs (recommendations; none answered)

1. **Accept-all is all-or-nothing.** *Recommended:* one batch under one `batchId` (ADR-013),
   replayed in dependency order inside one transaction. If any change is refused, nothing lands
   and the refusal names the change. Today's loop keeps whatever landed before the first refusal,
   which is the behaviour a single undo cannot reverse cleanly.
2. **Undoing an accept-all leaves the suggestions accepted-then-undone**, not pending. Undo stays
   ordinary compensating events (ADR-005), and does not also write suggestion state.
3. **Several suggesters in one batch.** *Recommended:* `Origin` gains a list of authors, and the
   History entry reads *"Accepted 7 suggestions from Sam and Ana"*.
4. **A snapshot is a side table, not an event.** *Recommended:* `trip_snapshots(trip_id, seq,
   name, created_by, created_at)`. It labels a position in the log and never occupies a `seq`.
   ADR-005 rejected marker events and a movable head, and this is neither. Restoring is today's
   revert-to-state, so it can already be undone.
5. **Who may snapshot:** editors and the owner. Suggesters cannot edit the plan, so they cannot
   restore it either. Deletion is a hard delete. The cap is 20 per trip.
6. **How the assistant authors suggestions.** Invariant 7 says the assistant takes only paths its
   user could take. *Recommended:* editors may create suggestions too (this relaxes spec W25), and
   an assistant suggestion records the editor as its author with `via: assistant`. It does not
   count against the 50-per-author pending cap.
7. **This supersedes ADR-022's ephemeral proposals for planning turns** that make more than one
   change. A one-change answer can still apply in place. That needs a new ADR.

## Scope

- A server *accept these changes* action, and *Accept all* moved onto it.
- Snapshots: save, rename, delete, a list above the History scroll, preview by `seq`, and restore.
  The assistant can save one before a proposal.
- The assistant's planning turns write suggestions, which the board's ghost overlay already
  draws (W46).

## Out of scope

- Restoring part of a trip (one day only). It stays a later idea if the whole-trip restore is used.
- Snapshots surviving log compaction. ADR-003 scopes compaction to planning events, and none has
  run. If one does, it must keep any `seq` that a snapshot points at.

## Exit gate

- [ ] **Decisions 1–7 are answered and recorded here**, and the new ADR is written.
- [ ] **Accepting ten changes writes one History entry and is undone by one undo**, in an
      integration test against real Postgres. The test was seen red against today's per-change
      loop.
- [ ] **A refused change in an accept-all lands nothing.**
- [ ] **A snapshot saves, previews and restores**, and the restore undoes in one step. A trip whose
      snapshot `seq` predates a deleted day restores that day.
- [ ] **An assistant planning turn on an editor's trip produces stored suggestions** that survive
      a reload and that a second editor can see. Covered by an integration test and the eval suite
      (M33); the eval re-run's numbers are pasted here.
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: ask for a day, see its
      suggestions on the board, accept all, see one History entry, restore the snapshot.
- [ ] **[walk]** The same flow on the PR preview with two editors.
- [ ] A retro is appended at gate close.
