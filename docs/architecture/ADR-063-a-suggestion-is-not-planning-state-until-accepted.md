# ADR-063: A suggestion is not planning state until it is accepted

**Status:** **Accepted — 2026-10-03.** Mitchell approved the design. This ADR records the boundary.
**Deciders:** Mitchell (product); Claude — drafted
Related: **ADR-003** (the history substrate is scoped to planning), **ADR-022** (the assistant's
proposals are ephemeral), spec `docs/specs/2026-10-03-suggester-role-design.md`.

## Context

Mitchell asked for a trip role between viewer and editor: a member who suggests changes that an
editor or the owner approves. That means storing a change that has not happened, for days, where
other people can see it.

Invariant 1 says every trip change is `command → validate → append → project`. It also says that
a feature needing half its state evented and half not is a boundary smell to escalate. A pending
suggestion sits right on that line. It is made of planning commands, but it is not a planning
fact. This was raised with Mitchell before anything was built.

## Decision

1. **A pending suggestion is Access-adjacent CRUD, not planning state.** It lives in its own
   tables (`trip_suggestions`, `trip_suggestion_changes`) in a new **Suggestions** module, with
   audit fields. Nothing about it goes on the trip's event stream. The stream records what the
   trip *is*, and a suggestion is a request about what it might become.
2. **The only way a suggestion reaches the trip is the command pipeline.** Accepting replays the
   stored commands through `executeTripCommandBatch` as the reviewer, so every rule an editor's
   own edit meets applies unchanged: access, validation, conflicts and projection. The row is
   marked accepted in the same transaction, through the existing `alsoInSameTransaction` hook,
   which is allowed to write CRUD and not planning state.
3. **The event records who asked.** A new `Origin` kind, `suggestion`, carries the suggestion,
   the change and the author. The envelope's `actorId` stays the reviewer, who is the one who
   made it happen. History stays truthful about both.
4. **No projection of unapplied state on the server.** What the trip would look like if a change
   were accepted is predicted on the client with `@tc/predict`, the same code the optimistic
   queue already trusts. The server stores commands and a sentence, never a predicted trip.

## Consequences

- Dismissing, withdrawing or ignoring a suggestion leaves no trace in the trip's history. The
  record of what was asked and refused is the CRUD rows, not the log. That is accepted: the log
  answers "what did the trip look like", not "what did anyone want".
- A stored change can go stale. Its target may be removed, or the head may move. That shows as
  "no longer applies" and is never repaired automatically.
- This is the second caller of `alsoInSameTransaction` after saved days.
  `server/commands.ts:214-232` says a second caller "is a signal the seam is wrong". It is
  re-read here: the hook writes only its own module's row, appends nothing and decides nothing,
  which is exactly the shape the comment permits. The comment is updated to name both callers.
- Realtime for suggestions rides the events poll as an opaque, role-scoped revision, rather than
  through events (spec W6).
