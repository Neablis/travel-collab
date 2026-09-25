### KI-2026-09-22-d — an open notebook editor does not show a co-traveller's edit, and should not until it can do it safely

- **Severity:** a gap in live collaboration, deliberately left. Not a defect —
  the alternative that "fixes" it destroys work.
- **Milestone:** **M14, carried (assigned 2026-09-24, KI pass)** — owned by M14 (the notebook/widget builder), not a gate box. Listed in `docs/milestones/M14-rich-layer.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/components/pages/PageScreen.tsx`.

- **What happens.** Two people open the same notebook page. One edits and the
  autosave lands. The other's editor keeps showing the document as it was when
  they opened it~~, and their next save overwrites the first person's work —
  last-write-wins, silently~~. **Struck 2026-09-25:** every commit now names
  the revision it was typed against (`expectedUpdatedAt`, a78843b); the server
  refuses a stale one (`pageCommands.ts:170-174`), and `PageScreen`'s
  `pageChanged` shows the other person's document and offers the author's own
  as a restorable draft (`PageScreen.tsx:530-556`). The one remaining
  last-write-wins path is an unload save overtaking a commit —
  `KI-2026-09-24-s`.

  The Overview tab (`OverviewLens`) DOES live-update as of 2026-09-22: page
  writes became events, so a notebook save moves the trip's `headSeq`, the poll
  notices, and the lens re-reads. That is the surface Mitchell reported and it
  is fixed. This is the other one.

- **WHY THE OBVIOUS FIX IS WRONG, which is the reason this is an entry rather
  than a task.** `PageScreen` is the EDITOR. Re-reading the document and
  replacing the editor's content because a poll fired would discard whatever
  the reader has typed since — mid-sentence, with no undo across the swap,
  triggered by somebody else's keystroke. That is worse than the staleness it
  fixes.

  ~~A second reason it is not wiring: `PageScreen` is not inside `TripProvider`,
  so it has no `remoteRevision` and no poll. That is fixable (`useTripBroadcast`
  is a standalone hook and takes a trip id) and is not the hard part.~~
  **Struck 2026-09-25:** `PageScreen` now subscribes with `useTripBroadcast`
  (`PageScreen.tsx:452`, a029066) — but refetches only `trip` and `globals`,
  never the page, deliberately, citing this entry (`PageScreen.tsx:423-426`).

- **What it actually wants** is the shape M13 link 4 already chose for stops: a
  CONFLICT, as data, in the page. *"Alice edited this page while you had it
  open"*, with the reader deciding. `concurrentEdits.ts` is the precedent —
  conflicts are values merged into what the surface already renders, never
  modal, never destructive.

  The reading mode is the easy half and could land first: `PageScreen` already
  distinguishes reading from editing (`READING_REFUSAL` names the "Edit page"
  control), and a page open for READING can be re-read safely because nothing
  is being typed into it.

- **Not a regression.** This surface never live-updated; before 2026-09-22 no
  notebook did, because page writes never reached the event log. What changed is
  that the machinery now exists, which is what makes the gap worth recording.

- **Found by:** building the notebook broadcast, 2026-09-22.
- **First noted:** 2026-09-22.
- **Re-verified 2026-09-25 (overnight sweep):** the core still holds — an open
  editor does not show a co-traveller's edit to the document; the poll now
  exists but does not re-read the page, and there is no "edited while you had
  it open" affordance until a save is refused. Two supporting claims struck in
  place (the silent overwrite on the next save, and "no poll"), with evidence.
