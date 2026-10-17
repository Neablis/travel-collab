### KI-2026-10-03-d — a suggester's unsent draft reads as pending work in History: its edits show as saving rows, and the history preview silently does nothing

- **Severity:** cosmetic (misleading rows, and a silent control). Nothing is written, lost or
  wrong. The rows belong to the optimistic queue and go when the draft is sent or discarded. The
  preview is refused for a real reason, but the reader isn't told what it is.
- **Area:**
  - `apps/web/src/components/trip/context/optimistic.ts`: `activeHistory` prepends a
    `pending: true` row for each queued unit.
  - `apps/web/src/components/trip/context/TripProvider.tsx`: `preview.enter` returns early on
    `if (pending) return;`.
  - `apps/web/src/components/board/HistoryPanel.tsx`, which draws the rows and calls `enter`.
- **Cause:** a suggester's draft *is* the optimistic queue (spec §2.3). So for as long as the draft
  exists, everything that reads `pending` treats it as unsent work. For an editor that state lasts
  one round trip. For a suggester it lasts until they send or discard.
- **Symptom / What happens:**
  1. *Pending rows.* A suggester makes two edits. The tray reads "2 changes not sent", and
     History lists the same two edits at the top as pending rows. Those are the rows an editor
     sees for a change on its way to the server. A suggester's edits are not on their way
     anywhere: History is the trip's record, and they reach it only if a reviewer accepts them.
  2. *Silent preview.* With a draft in the tray, the suggester clicks a History entry. Nothing
     happens: no preview and no message, because a preview can't branch from unconfirmed state.
- **Why not fixed here:** found while building the suggester role (spec 2026-10-03, §6). Both are
  display or wording decisions, not quiet changes to a shared helper:
  - (1) likely means `activeHistory` or the panel leaves pending rows out in suggest mode, since
    the tray already counts the draft (W38).
  - (2) either says why ("Send or discard your suggestion to look back"), or lets a suggester
    preview over a draft that is never sent as commands. The second needs `enter` to stop
    treating a draft as unsent work. That is the same `pending` reading that `dispatch`'s
    history-command branch keeps as an undecided product rule (its comment, after KI-090).
- **Cross-reference:** spec `docs/specs/2026-10-03-suggester-role-design.md` §2.3, W7, W13, W38;
  ADR-064; `resolved/KI-090-…` (it left the same silent `return` on the history-command path as a
  product rule); KI-2026-10-03-g (merged here on 2026-10-17, moved to `resolved/` as a duplicate).
- **First noted:** 2026-10-03, while building the suggester role; moved here from the spec's §6
  in that branch's review.
