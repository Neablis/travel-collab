# M40 — A big change is reviewed whole, taken whole, and undone whole

**Status:** **Scoped 2026-10-09.** Mitchell answered all seven decisions as recommended, after a
plain-language walk-through of each, and confirmed Decision 2 on its own (undo leaves the
suggestions accepted-then-undone). Built as three parts after a phase-0 PR that tracks this gate
(`docs/plans/2026-10-09-M40-big-change.md`). Placed after M39; minted from `docs/candidates.md`
(see `docs/milestones/README.md`, *2026-10-06 — proposed: M37 to M47*).

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

## Decisions (answered 2026-10-09, all as recommended)

1. **Accept-all is all-or-nothing.** One batch under one `batchId` (ADR-013),
   replayed in dependency order inside one transaction. If any change is refused, nothing lands
   and the refusal names the change. Today's loop keeps whatever landed before the first refusal,
   which is the behaviour a single undo cannot reverse cleanly. This reverses the suggester
   spec's rejection of a batch-accept endpoint (`docs/specs/2026-10-03-suggester-role-design.md`,
   W77), at Mitchell's request.
2. **Undoing an accept-all leaves the suggestions accepted-then-undone**, not pending. Undo stays
   ordinary compensating events (ADR-005), and does not also write suggestion state.
3. **Several suggesters in one batch.** `Origin` gains a list of authors, and the
   History entry reads *"Accepted 7 suggestions from Sam and Ana"*.
4. **A snapshot is a side table, not an event.** `trip_snapshots(trip_id, seq,
   name, created_by, created_at)`. It labels a position in the log and never occupies a `seq`.
   ADR-005 rejected marker events and a movable head, and this is neither. Restoring is today's
   revert-to-state, so it can already be undone.
5. **Who may snapshot:** editors and the owner. Suggesters cannot edit the plan, so they cannot
   restore it either. Deletion is a hard delete. The cap is 20 per trip.
6. **How the assistant authors suggestions.** Invariant 7 says the assistant takes only paths its
   user could take. Editors may create suggestions too (this relaxes spec W25), and
   an assistant suggestion records the editor as its author with `via: assistant`. It does not
   count against the 50-per-author pending cap.
7. **This supersedes ADR-022's ephemeral proposals for planning turns** that make more than one
   change. A one-change answer can still apply in place. Recorded as
   `docs/architecture/ADR-067-a-multi-change-assistant-turn-is-stored-as-suggestions.md`.

## Scope — the build, as three parts

Each part is one PR in a stack (`docs/guidelines/stacked-prs.md`), after the phase-0 PR that
carries this file, the plan and ADR-067. The order is the decisions' dependency order: Part 3
uses both Part 1's batch accept and Part 2's snapshots.

| Part | What | Decisions | Gate boxes |
|---|---|---|---|
| 1 | A server *accept these changes* action (all-or-nothing, one `batchId`, an `Origin` that lists the authors); *Accept all* moved onto it | 1, 2, 3 | 2, 3 |
| 2 | Named snapshots: `trip_snapshots` (migration), save, rename, delete, a list above the History scroll, preview by `seq`, restore through `RevertToState` | 4, 5 | 4 |
| 3 | Editors (and the assistant for them) may suggest; a planning turn of more than one change stores a suggestion `via: assistant`, after saving a snapshot; the eval grader updated (not re-run); the e2e | 6, 7 | 5, 6 |

Then the gate: the ci-like e2e on the top part, the two-editor walk on its preview, the retro.

## Out of scope

- Restoring part of a trip (one day only). It stays a later idea if the whole-trip restore is used.
- Snapshots surviving log compaction. ADR-003 scopes compaction to planning events, and none has
  run. If one does, it must keep any `seq` that a snapshot points at.

## Exit gate

- [x] **Decisions 1–7 are answered and recorded here**, and the new ADR is written. *Ticked
      2026-10-09: answered by Mitchell in session, all as recommended; ADR-067 written in the
      phase-0 PR.*
- [x] **Accepting ten changes writes one History entry and is undone by one undo**, in an
      integration test against real Postgres. The test was seen red against today's per-change
      loop. *Ticked 2026-10-10: #376, seen red against the loop as `expected … to have a length of
      3 but got 12`. Mitchell's stacked case (add a day, move a stop onto it, retime it) is one
      entry applied in order and one undo, seen red with the position sort reversed.*
- [x] **A refused change in an accept-all lands nothing.** *Ticked 2026-10-10: #376, seen red as
      `expected 5 to be 4`.*
- [x] **A snapshot saves, previews and restores**, and the restore undoes in one step. A trip whose
      snapshot `seq` predates a deleted day restores that day. *Ticked 2026-10-10: #377, seen red as
      `expected 2 to be 1` and `expected [] to deeply equal [ Array(1) ]`. `0045` applied by
      `migrate-production` run 43.*
- [x] **An assistant planning turn on an editor's trip produces stored suggestions** that survive
      a reload and that a second editor can see. Covered by an integration test against
      a mocked model, and the eval grader (M33) passes a stored suggestion in its own free tests.
      *The live eval re-run was dropped from this box by Mitchell on 2026-10-09: Parts 1 and 2 do
      not touch the assistant, and a paid eval run is never started without asking him first.*
      *Ticked 2026-10-10: #378, a second editor lists the suggestion after a fresh read; seen red
      with storing turned off as `expected { proposal: {…} } to not have property "proposal"`.
      `grade.test.ts` and `replay.int.test.ts` pass a stored suggestion.*
- [ ] **The e2e spec passes on `pnpm --filter web test:e2e:ci-like`**: ask for a day, see its
      suggestions on the board, accept all, see one History entry, restore the snapshot.
- [x] **[walk]** The same flow on the PR preview with two editors. *Ticked 2026-10-10: Mitchell
      walked #378's preview. The walk found that a suggested new day was not drawn (fixed by #381,
      for the assistant and a suggester alike), asked for Accept all in the chat (`3539b7a`) and
      for a moved stop to say where it is going (`2d6a7b8`). He resolved both threads and merged.
      A second person seeing the suggestions is held by the integration test and `suggester.spec.ts`
      rather than by hand.*
- [ ] A retro is appended at gate close.
